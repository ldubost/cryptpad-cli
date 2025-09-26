
// make-pad.js

const CpNetflux = require('chainpad-netflux');
const CpCrypto = require('chainpad-crypto');
const ChainPad = require('chainpad');
const Netflux = require("netflux-websocket");
const WebSocket = require("ws");

// console.log(CpCrypto.createEditCryptor2());

const makePad = (type = "code", content, wsUrl, baseUrl, title, cb) => {
    const newPadKeys = CpCrypto.createEditCryptor2();
    const newPadUrl = baseUrl + `/${type}/#/2/${type}/edit/${newPadKeys.editKeyStr}`;
    
    const getNetwork = () => {
        const f = () => {
            return new WebSocket(wsUrl);
        };  
        return Netflux.connect('', f); 
    };

    const base64ToHex = (b64String) => {
        const hexArray = []; 
        atob(b64String.replace(/-/g, '/')).split("").forEach((e) => {
            let h = e.charCodeAt(0).toString(16);
            if (h.length === 1) { h = "0"+h; }
            hexArray.push(h);
        });
        return hexArray.join("");
    };  

    const keys = newPadKeys;
    const channel = base64ToHex(keys.chanId);

    const config = { 
        network: getNetwork(),
        channel: channel,
        crypto: CpCrypto.createEncryptor(keys),
        logLevel: 1,
        ChainPad: ChainPad
    };  
    let rt;
    config.onReady = info => {
        let chainpad = info.realtime;
        if (!chainpad) { return void cb('Error'); }
        
        // Update content with title if provided
        let finalContent = content;
        if (title) {
            try {
                const contentObj = JSON.parse(content);
                
                // Ensure metadata object exists
                if (!contentObj.metadata) {
                    contentObj.metadata = {};
                }
                
                // Add title to metadata
                contentObj.metadata.title = title;
                
                finalContent = JSON.stringify(contentObj);
            } catch (e) {
                // If content is not JSON, create proper structure with metadata
                finalContent = JSON.stringify({
                    content: content,
                    metadata: {
                        title: title
                    }
                });
            }
        }
        
        chainpad.contentUpdate(finalContent);
        chainpad.onSettle(() => {
            cb(void 0, newPadUrl);
            if (rt) { rt.stop(); }
        });
    };

    rt = CpNetflux.start(config);

    return rt; 

};

module.exports = { makePad }




//=============================
// usage
/*
const { makePad } = require('./make-pad.js')

const baseUrl = 'http://localhost:3000';
const wsUrl = 'ws://localhost:3000/cryptpad_websocket';
const newCodeContent = '{"content":"Test"}';

makePad('code', newCodeContent, wsUrl, baseUrl, 'My Code File', function (err, url) {
    if (err) { return console.error(err); }        
    console.log('Pad created, available at:', url)
});
*/