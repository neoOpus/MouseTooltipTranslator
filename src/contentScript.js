'use strict';
// inject translation tooltip based on user text hover event
//it gets translation and tts from background.js
//intercept pdf url

import $ from "jquery";
import 'bootstrap/js/dist/tooltip';
var isUrl = require('is-url');
import {
  enableSelectionEndEvent
} from "./selection";
import {
  getSettingFromStorage
} from "./setting";


//init environment var======================================================================\
var currentSetting = {};
var tooltipContainer;
var clientX = 0;
var clientY = 0;
var mouseTarget = null;
var activatedWord = null;
var mouseMoved = false;
var mouseMovedCount=0;
var settingLoaded = false;
var keyDownList = {}; //use key down for enable translation partially
var style = $("<style>").appendTo("head");
let selectedText = "";
var rtlLangList = [
  "ar", //Arabic
  "iw", //Hebrew
  "ku", //Kurdish
  "fa", //Persian
  "ur", //Urdu
  "yi", //Yiddish
]; //right to left language system list



//tooltip core======================================================================
//tooltip init
$(document).ready(function() {
  getSetting(); //load setting from background js

  tooltipContainer = $('<div/>', {
    id: 'mttContainer',
    class: 'bootstrapiso', //use bootstrapiso class to apply bootstrap isolation css
    css: {
      "left": 0,
      "top": 0,
      "position": "fixed",
      "z-index": "100000200",
      "width": "500px",
      "margin-left": "-250px",
      "background-color": "#00000000", //transparent
      "backdrop-filter": "blur(12px)", // Mica effect
      "pointer-events": "none" //click through
    }
  }).appendTo(document.body);

  tooltipContainer.tooltip({
    placement: "top",
    container: "#mttContainer",
    trigger: "manual"
  });
});



//determineTooltipShowHide based on hover, check mouse over word on every 700ms
setInterval(async function() {
  // only work when tab is activated and when mousemove and no selected text
  if (!selectedText && document.visibilityState == "visible" && mouseMoved && settingLoaded && currentSetting["translateWhen"].includes("mouseover")) {
    let word = getMouseOverWord(clientX, clientY);
    await processWord(word, "mouseover");
  }
}, 700);

//determineTooltipShowHide based on selection
enableSelectionEndEvent(); //set mouse drag text selection event
document.addEventListener("selectionEnd", async function(event) {
  // if translate on selection is enabled
  if (document.visibilityState === "visible" && settingLoaded && currentSetting["translateWhen"].includes("select")) {
    selectedText = event.selectedText;
    await processWord(selectedText, "select");
  }
}, false);

//process detected word
async function processWord(word, actionType) {
  word = filterWord(word); //filter out one that is url,over 1000length,no normal char

  if (word && activatedWord != word) { //show tooltip, if current word is changed and word is not none
    activatedWord = word;
    var {translatedText,sourceLang,targetLang} = await translate(word);

    //if respond text is not empty, process text
    if (translatedText) {
      //if tooltip is on or activation key is pressed, show tooltip
      //if current word is recent activatedWord
      if ((currentSetting["useTooltip"] == "true" || keyDownList[currentSetting["keyDownTooltip"]]) && activatedWord == word && document.visibilityState == "visible") {
        showTooltip(translatedText,targetLang);

        //if record trigger is activated, do record
        if (currentSetting["historyRecordActions"].includes(actionType)) {
          recordHistory(word, translatedText);
        }
      }
      //if use_tts is on or activation key is pressed, do tts
      if (currentSetting["useTTS"] == "true" || keyDownList[currentSetting["keyDownTTS"]]) {
        tts(word, sourceLang);
      }
    } else {
      hideTooltip(false);
    }
  } else if (!word && activatedWord) { //hide tooltip, if activated word exist and current word is none
    hideTooltip();
  }
}

function getMouseOverWord(clientX, clientY) {
  //check is image
  var imageOutput = checkImage(clientX, clientY);
  if (imageOutput) {
    return imageOutput;
  }

  //get mouse positioned char
  var range = document.caretRangeFromPoint(clientX, clientY);
  //if no range or is not text, give null
  if (range == null || range.startContainer.nodeType !== Node.TEXT_NODE) {
    return "";
  }

  //expand char to get word,sentence based on setting 
  //except if mouse target is special web block which need to be handled as block for clarity, handle as block 
  try{
    if (currentSetting["detectType"] == "container" || checkMouseTargetIsSpecialWebBlock()) {
      range.setStartBefore(range.startContainer);
      range.setEndAfter(range.startContainer);
    } else if (currentSetting["detectType"] == "word") {
      range.expand('word');
    } else if (currentSetting["detectType"] == "sentence") {
      range.expand('sentence');
    }
  } catch (error) {  }

  //check mouse is actually in text bound rect
  var rect = range.getBoundingClientRect(); //mouse in word rect
  if (rect.left > clientX || rect.right < clientX ||
    rect.top > clientY || rect.bottom < clientY) {
    return "";
  }
  return range.toString();
}

function checkMouseTargetIsSpecialWebBlock(){
  return mouseTarget.className == "ytp-caption-segment" ||   //youtube caption
  mouseTarget.className=="LC20lb MBeuO DKV0Md"  //google search list title block
}

function filterWord(word) {
  word = word.replace(/\s+/g, ' '); //replace whitespace as single space
  word = word.trim(); // remove whitespaces from begin and end of word
  if (word.length > 1000 || //filter out text that has over 1000length
    isUrl(word) || //if it is url
    !/[^\s\d»«…~`!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?\$\xA2-\xA5\u058F\u060B\u09F2\u09F3\u09FB\u0AF1\u0BF9\u0E3F\u17DB\u20A0-\u20BD\uA838\uFDFC\uFE69\uFF04\uFFE0\uFFE1\uFFE5\uFFE6]/g.test(word)) { // filter one that only include num,space and special char(include currency sign) as combination
    word = "";
  }
  return word;
}

function showTooltip(text,lang) {
  applyLangAlignment(lang);
  tooltipContainer.attr("data-original-title", text); //place text on tooltip
  tooltipContainer.tooltip("show");
}

function hideTooltip(resetActivatedWord=true) {
  if(resetActivatedWord){
    activatedWord=null;
  }
  tooltipContainer.tooltip("hide");
}

function applyLangAlignment(lang) {
  var isRtl= (rtlLangList.includes(lang)) ? "rtl" : "ltr";
  tooltipContainer.attr("dir", isRtl);
}

function setTooltipPosition() {
  if(tooltipContainer){
    tooltipContainer.css("transform", "translate(" + clientX + "px," + clientY + "px)");
  }
}

async function translate(word) {
  var response = await translateSentence(word, currentSetting["translateTarget"]);

  //if lang are same, reverse translate
  if (currentSetting["translateTarget"] == response.sourceLang) {
    if (currentSetting["translateReverseTarget"] != "null") {
      response = await translateSentence(word, currentSetting["translateReverseTarget"]);
    } else {
      response.translatedText = "";
    }
  }

  return response;
}

//event listner - detect mouse move, key press, mouse press, tab switch==========================================================================================
//use mouse position for tooltip position
$(document).mousemove(function(event) {
  //if mouse moved far distance two times, check as mouse moved
  if(mouseMoved ==false && Math.abs(event.clientX-clientX)+Math.abs(event.clientY-clientY)>3){
    if(mouseMovedCount<2){
      mouseMovedCount+=1;
    }else{
      mouseMoved = true;
    }    
  }
  clientX = event.clientX;
  clientY = event.clientY;
  mouseTarget = event.target;  
  setTooltipPosition();
});
//detect activation hold key pressed
$(document).keydown(function(e) {
  if ((e.keyCode == 65 || e.keyCode == 70) && e.ctrlKey) { //user pressed ctrl+f  ctrl+a, hide tooltip
    mouseMoved = false;
    hideTooltip(false);
  } else {
    if ([currentSetting["keyDownTooltip"], currentSetting["keyDownTTS"]].includes(e.which.toString()) && keyDownList[e.which] != true) { // check activation hold key pressed, run tooltip again with key down value
      keyDownList[e.which] = true;
      activatedWord = null; //restart word process
      if (selectedText != "") { //restart select if selected value exist
        processWord(selectedText, "select");
      }
    }
  }
});
$(document).keyup(function(e) {
  if (keyDownList.hasOwnProperty(e.which)) {
    keyDownList[e.which] = false;
  }
});

//detect tab switching to reset env
window.addEventListener('blur', function(event) {
  keyDownList = {}; //reset key press
  mouseMoved = false;
  mouseMovedCount=0;
  selectedText = "";
  hideTooltip();
});

//send to background.js for background processing and setting handling ===========================================================================
function translateSentence(word, translateTarget) {
  return sendMessagePromise({
    type: 'translate',
    word: word,
    translateTarget: translateTarget
  });
}

function sendMessagePromise(item) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(item, response => {
      resolve(response);
    });
  });
}

function tts(word, lang) {
  chrome.runtime.sendMessage({
      type: 'tts',
      word: word,
      lang: lang
    },
    response => {}
  );
}

function recordHistory(sourceText, targetText) {
  chrome.runtime.sendMessage({ //send history to background.js
      type: 'recordHistory',
      "sourceText": sourceText,
      "targetText": targetText,
    },
    response => {}
  );
}

async function getSetting() { //load  setting from background js
  currentSetting = await getSettingFromStorage();
  applyStyleSetting(currentSetting);
  detectPDF();
  settingLoaded = true;
}

//detect storage value changes, update current setting value
chrome.storage.onChanged.addListener(function(changes, namespace) {
  for (var key in changes) {
    currentSetting[key] = changes[key].newValue;
  }
  // if style changed
  if (changes["tooltipFontSize"] || changes["tooltipWidth"]) {
    applyStyleSetting(currentSetting);
  }
  if (changes["translateWhen"]) {
    selectedText = ""
  }
});

function applyStyleSetting(setting) {
  //apply css
  style.html(`
    .bootstrapiso .tooltip {
      font-size: ` + setting["tooltipFontSize"] + `px;
    }
    .bootstrapiso .tooltip-inner {
      max-width: ` + setting["tooltipWidth"] + `px;
    }
    `);
}

function detectPDF() {
  if (currentSetting["detectPDF"] == "true") {
    if (document.body.children[0].type == "application/pdf") {
      window.location.replace(chrome.runtime.getURL('/pdfjs/web/viewer.html') + '?file=' + encodeURIComponent(window.location.href));
    }
  }
}

//ocr==================================================================================
var ocrText = null; //text
var ocrImgX = 0;
var ocrImgY = 0;
var ocrSendTimeID = 0;
var ocrRecentReceivedID = 0;
var ocrUrl = "";
var ocriframe;

//detect mouse positioned image to process in iframe
//send image when mouse pointing
//recieve ocr processed text and return recent recieved text
function checkImage(clientX, clientY) { //if mouse target on image, process ocr
  if (currentSetting["useOCR"] == "true" && //when use ocr setting on
    mouseTarget != null && mouseTarget.tagName === 'IMG' && //when mouse over on img
    mouseTarget.complete && mouseTarget.naturalHeight !== 0) { //if image is loaded

    //if mouse move, do ocr using background js
    if (ocrImgX != clientX || ocrImgY != clientY) {
      (async () => {
        ocrImgX = clientX;
        ocrImgY = clientY;
        mouseTarget.style.cursor = 'wait'; //show mouse loading

        //mouse position on image width height
        var bounds = mouseTarget.getBoundingClientRect();
        var x = clientX - bounds.left;
        var y = clientY - bounds.top;
        var px = parseInt(x / mouseTarget.clientWidth * mouseTarget.naturalWidth);
        var py = parseInt(y / mouseTarget.clientHeight * mouseTarget.naturalHeight);

        //ocr img url init
        if (mouseTarget.src != ocrUrl) {
          ocrText = null;
          ocrUrl = mouseTarget.src;
        }

        //create ocr iframe
        if (!ocriframe) {
          ocriframe = $('<iframe />', {
            name: 'ocrFrame',
            id: 'ocrFrame',
            src: chrome.runtime.getURL('/ocr.html'),
            css: {
              'display': 'none'
            }
          }).appendTo('body').get(0);

          await sleep(100);
        }

        //send to ocr iframe
        ocrSendTimeID = Date.now(); //current sending time
        ocriframe.contentWindow.postMessage({
          "type": 'ocr',
          "mainUrl": ocrUrl,
          "base64Url": "",
          "time": ocrSendTimeID,
          "px": px,
          "py": py,
          "lang": currentSetting["ocrDetectionLang"]
        }, '*');
      })();
    }

    //pass saved data
    if (mouseTarget.src == ocrUrl && ocrText != null) { //if selected image is processed and recieved
      return ocrText;
    }
  }
  return null;
}

//ocr iframe communcation handler
window.addEventListener("message", function(response) {
  //if success save data
  if (response.data.type == "success") {
    if (response.data.mainUrl == ocrUrl && ocrRecentReceivedID < response.data.time) { //check url and is recent one
      ocrText = response.data.text;
      ocrRecentReceivedID = response.data.time;
      if (response.data.time == ocrSendTimeID) { //if get most recent one, stop mouse loading
        mouseTarget.style.cursor = '';
      }
    }
    //if fail, resend with base64 data
  } else if (response.data.type == "fail") {
    if (response.data.base64Url == "") {
      (async () => {
        var ocrBase64Url = await getBase64(response.data.mainUrl);
        ocriframe.contentWindow.postMessage({
          type: 'ocr',
          "mainUrl": response.data.mainUrl,
          "base64Url": ocrBase64Url,
          "time": response.data.time,
          "px": response.data.px,
          "py": response.data.py,
          "lang": currentSetting["ocrDetectionLang"]
        }, '*');
      })();
    }
  }
}, false);

function getBase64(url) {
  return new Promise(function(resolve, reject) {
    fetch(url)
      .then(response => response.blob())
      .then(blob => {
        var reader = new FileReader();
        reader.onload = function() {
          resolve(this.result) // <--- `this.result` contains a base64 data URI
        };
        reader.readAsDataURL(blob);
      });
  });
}

function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}
