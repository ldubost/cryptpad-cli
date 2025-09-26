// CryptPad drive adapter exposing the same interface as memory adapter
// Currently implements list('/') by reading from rt.proxy.drive.root
const { getPad } = require('../cryptpad/pad');
const { getCryptPadDrive } = require('../cryptpad/drive');
const { makePad } = require('../cryptpad/makepad');
const HyperJson = require('hyper-json');
const { JSDOM } = require('jsdom');
const dom = new JSDOM();
const Crypto = require('node:crypto');
                

function normalize(path) {
    if (!path) return '/';
    let p = String(path).replace(/\\/g, '/');
    if (!p.startsWith('/')) p = '/' + p;
    const parts = [];
    p.split('/').forEach(seg => {
        if (!seg || seg === '.') return;
        if (seg === '..') parts.pop(); else parts.push(seg);
    });
    return '/' + parts.join('/');
}

function join(a, b) {
    if (!b || b === '/') return normalize(a);
    if (b.startsWith('/')) return normalize(b);
    if (a.endsWith('/')) return normalize(a + b);
    return normalize(a + '/' + b);
}

module.exports = function createDriveAdapter(options = {}) {
    const { driveUrl, wsURL, serverOrigin } = options;
    let currentDriveRt = getCryptPadDrive(driveUrl, wsURL);
    const driveInstances = [{ url: driveUrl, rt: currentDriveRt }];
    let isReady = false;
    const readyPromise = new Promise((resolve, reject) => {
        currentDriveRt.proxy.on('ready', () => { isReady = true; resolve(); })
               .on('error', (info) => { reject(info); });
    });

    // Derive a clean origin (protocol + host[:port]) from provided serverOrigin or URL
    let baseOrigin = '';
    if (serverOrigin) {
        try {
            baseOrigin = new URL(serverOrigin).origin;
        } catch (_) {
            try { baseOrigin = new URL('https://' + String(serverOrigin).replace(/^https?:\/\//, '')).origin; } catch (_) { baseOrigin = String(serverOrigin); }
        }
    }
    let folderStack = []; // stack of nested standard folders (objects)
    let currentFolder = null; // mirror top of stack for quick access

    function getDriveObject() {
        // Handle different structures: main drive has nested 'drive', shared folders have flat structure
        const isMainDrive = currentDriveRt === driveInstances[0]?.rt;
        return currentDriveRt && currentDriveRt.proxy && (isMainDrive ? currentDriveRt.proxy.drive : currentDriveRt.proxy);
    }

    function getBaseOrigin() {
        // Get the correct base origin for the current drive
        const currentInstance = driveInstances.find(inst => inst.rt === currentDriveRt);
        if (currentInstance && currentInstance.url) {
            try {
                return new URL(currentInstance.url).origin;
            } catch (_) {
                // Fallback to original baseOrigin
            }
        }
        return baseOrigin;
    }

    function getRootEntries() {
        const drive = getDriveObject();
        const container = (currentFolder) || (drive && drive.root);
        if (!container) return [];
        return Object.keys(container).sort();
    }

    function getPath() {
        // Build path with color coding
        const BLUE = '\x1b[34m';
        const BRIGHT_BLUE = '\x1b[94m';
        const RESET = '\x1b[0m';
        
        // Check if we're in a shared folder by comparing currentDriveRt with the original
        const isInSharedFolder = currentDriveRt !== driveInstances[0]?.rt;
        
        let path = BRIGHT_BLUE + 'Home' + RESET;
        
        if (isInSharedFolder) {
            // Find which shared folder we're in and get its name from the original drive
            const sharedInstance = driveInstances.find(inst => inst.rt === currentDriveRt && inst !== driveInstances[0]);
            if (sharedInstance) {
                // Try to find the shared folder name from the original drive's sharedFolders
                const originalDrive = driveInstances[0].rt && driveInstances[0].rt.proxy && driveInstances[0].rt.proxy.drive;
                const sharedFolders = originalDrive && originalDrive.sharedFolders;
                let folderName = 'shared';
                
                if (sharedFolders) {
                    // Find the shared folder by matching the URL
                    for (const [id, meta] of Object.entries(sharedFolders)) {
                            if (meta && meta.href) {
                                const href = meta.href;
                                let fullUrl = href;
                                const currentBaseOrigin = getBaseOrigin();
                                try { 
                                    fullUrl = new URL(href, currentBaseOrigin || undefined).toString(); 
                                } catch (_) { 
                                    fullUrl = (currentBaseOrigin || '').replace(/\/?$/, '/') + href.replace(/^\//, ''); 
                                }
                            if (fullUrl === sharedInstance.url) {
                                folderName = (meta.lastTitle || meta.title || 'shared');
                                break;
                            }
                        }
                    }
                }
                path += ' > ' + BRIGHT_BLUE + folderName + RESET;
            } else {
                path += ' > ' + BRIGHT_BLUE + 'shared' + RESET;
            }
        }
        
        if (folderStack.length > 0) {
            const names = folderStack.map(item => {
                const name = item && item.name ? item.name : '(folder)';
                return BRIGHT_BLUE + name + RESET;
            });
            path += ' > ' + names.join(' > ');
        }
        
        return path;
    }

    function resolveMetaFromId(id) {
        const drive = getDriveObject();
        if (!drive) return null;
        const key = String(id);
        const filesData = drive.filesData || {};
        if (Object.prototype.hasOwnProperty.call(filesData, key)) {
            return { kind: 'file', meta: filesData[key] };
        }
        const sharedFolders = drive.sharedFolders || {};
        if (Object.prototype.hasOwnProperty.call(sharedFolders, key)) {
            return { kind: 'sharedFolder', meta: sharedFolders[key] };
        }
        return null;
    }

    function findSharedFolderByTitle(title) {
        const drive = getDriveObject();
        const sharedFolders = drive && drive.sharedFolders;
        if (!sharedFolders) return null;
        const entries = Object.entries(sharedFolders);
        for (const [id, meta] of entries) {
            const t = (meta && (meta.lastTitle || meta.title)) || '';
            if (t === title) return { id, meta };
        }
        return null;
    }

    function findRtByUrl(url) {
        const found = driveInstances.find(inst => inst.url === url);
        return found ? found.rt : null;
    }

    return {
        normalize,
        join,
        isSubPath: () => false,
        stat: async (path) => {
            if (!isReady) await readyPromise;
            const p = normalize(path);
            if (p === '/') return { type: 'dir' };
            return null; // not implemented yet
        },
        list: async (path) => {
            // Don't wait for original readyPromise when in shared folder
            if (currentDriveRt === driveInstances[0]?.rt && !isReady) await readyPromise;
            const p = normalize(path);
            if (p !== '/') throw new Error('Only root listing is implemented');
            return getRootEntries();
        },
        listDisplay: async (path) => {
            // Don't wait for original readyPromise when in shared folder
            if (currentDriveRt === driveInstances[0]?.rt && !isReady) await readyPromise;
            const p = normalize(path);
            if (p !== '/') throw new Error('Only root listing is implemented');
            
            const drive = getDriveObject();
            const container = currentFolder || (drive && drive.root);
            const filesData = drive && drive.filesData;
            const names = Object.keys(container || {}).sort();
            const maxName = names.reduce((m, n) => Math.max(m, n.length), 0);
            return names.map((name) => {
                const value = container[name];
                // ANSI colors
                const BLUE = '\x1b[34m';
                const BRIGHT_BLUE = '\x1b[94m';
                const RESET = '\x1b[0m';

                const left = name.padEnd(maxName + 2, ' '); // 2-space gap before '- '

                if (value && typeof value === 'object') {
                    // Regular folder at root: show name and duplicate as title
                    const label = left + '- ' + name;
                    return BRIGHT_BLUE + label + RESET;
                }
                const resolved = resolveMetaFromId(value);
                if (resolved && resolved.kind === 'sharedFolder') {
                    const title = resolved.meta && (resolved.meta.lastTitle || resolved.meta.title) ? (resolved.meta.lastTitle || resolved.meta.title) : '';
                    const label = title ? (left + '- ' + title) : name;
                    return BLUE + label + RESET;
                }
                const key = String(value);
                const meta = filesData && Object.prototype.hasOwnProperty.call(filesData, key) ? filesData[key] : null;
                const title = meta && meta.title ? meta.title : '';
                return title ? (left + '- ' + title) : name;
            });
        },
        cat: async (from, name, print) => {
            const cwd = normalize(from);
            if (cwd !== '/') throw new Error('Only root-level cat is implemented');
            if (!name) throw new Error('Usage: cat <name>');
            const drive = getDriveObject();
            const container = (currentFolder) || (drive && drive.root);
            if (!container) throw new Error('Not found');
            
            let value;
            if (Object.prototype.hasOwnProperty.call(container, name)) {
                value = container[name];
            } else {
                // Try to find by title in filesData (only for documents, not folders)
                const filesData = drive && drive.filesData;
                if (filesData) {
                    for (const [id, meta] of Object.entries(filesData)) {
                        if (meta && meta.title === name) {
                            // Check if this ID corresponds to a document (not a folder)
                            // by checking if it's not an object in the container
                            const containerValue = container[id];
                            if (containerValue && typeof containerValue !== 'object') {
                                value = id;
                                break;
                            }
                        }
                    }
                }
                if (!value) throw new Error('Not found');
            }
            if (value && typeof value === 'object') throw new Error('Not a file');
            const resolved = resolveMetaFromId(value);
            if (!resolved) throw new Error('Not found');
            if (resolved.kind !== 'file') throw new Error('Not a file');
            const href = resolved.meta && resolved.meta.roHref ? resolved.meta.roHref : '';
            let fullUrl = href;
            const currentBaseOrigin = getBaseOrigin();
            try { fullUrl = new URL(href, currentBaseOrigin || undefined).toString(); } catch (_) { fullUrl = (currentBaseOrigin || '').replace(/\/?$/, '/') + String(href).replace(/^\//, ''); }
            // Use provided websocket URL from adapter options
            const wsUrl = wsURL;
            // print("URL: " + fullUrl);
            return await new Promise((resolve) => {
                let chainpad;
                let resolved = false;
                let rtPad;


                global.document = dom.window.document;

                const safeParseDoc = () => {
                    if (!chainpad) { return; }
                    try {
                        let doc = JSON.parse(chainpad.getUserDoc());
                        if (Array.isArray(doc)) {
                            let parsed = doc.slice(0,-1);
                            return HyperJson.toDOM(parsed).textContent;
                        }
                        
                        // Handle different content types
                        if (doc && typeof doc === 'object') {
                            // Check if it's HTML content (contains HTML tags)
                            const content = doc.content || doc;
                            if (typeof content === 'string' && (content.includes('<') && content.includes('>'))) {
                                // It's HTML content, return as-is
                                return content;
                            } else if (typeof content === 'object') {
                                // It's a JSON object, stringify it
                                return JSON.stringify(content, null, 2);
                            } else {
                                // It's a string, return as-is
                                return content;
                            }
                        }
                        
                        return doc.content || doc;
                    } catch (e) {
                        console.error(e);
                        return 'ERROR';
                    }
                };

                const tryResolve = () => {
                    if (resolved) return;
                    const content = safeParseDoc();
                    if (content && content !== '') {
                        resolved = true;
                        try { if (rtPad && typeof rtPad.stop === 'function') rtPad.stop(); } catch (_) {}
                        resolve({ url: fullUrl, content });
                    }
                };

                const onReady = (info) => {
                    chainpad = info.realtime;
                    tryResolve();
                };

                rtPad = getPad(fullUrl, wsUrl, { onReady });

                // Poll briefly in case onRemote is not emitted promptly
                const poll = setInterval(() => {
                    tryResolve();
                    if (resolved) clearInterval(poll);
                }, 300);

                // Timeout fallback
                setTimeout(() => {
                    if (!resolved) {
                        clearInterval(poll);
                        try { if (rtPad && typeof rtPad.stop === 'function') rtPad.stop(); } catch (_) {}
                        resolve({ url: fullUrl });
                        resolved = true;
                    }
                }, 20000);
            });
        },
        info: async (from, name) => {
            // Don't wait for original readyPromise when in shared folder
            if (currentDriveRt === driveInstances[0]?.rt && !isReady) await readyPromise;
            const cwd = normalize(from);
            if (cwd !== '/') throw new Error('Only root info is implemented');
            if (!name) throw new Error('Usage: info <name>');
            const drive = getDriveObject();
            const container = currentFolder || (drive && drive.root);
            if (!container) throw new Error('Not found in root');
            let value;
            if (Object.prototype.hasOwnProperty.call(container, name)) {
                value = container[name];
            } else {
                // Try to find by title in shared folders
                const byTitle = findSharedFolderByTitle(name);
                if (byTitle) return byTitle.meta;
                
                // Try to find by title in filesData (only for items in current folder)
                const filesData = drive && drive.filesData;
                if (filesData) {
                    // First, get all document IDs that are in the current folder
                    const folderDocumentIds = [];
                    for (const [folderName, folderValue] of Object.entries(container)) {
                        if (typeof folderValue !== 'object') {
                            folderDocumentIds.push(folderName);
                        }
                    }
                    
                    // Then, for each document in the folder, check if its title matches
                    for (const id of folderDocumentIds) {
                        const meta = filesData[id];
                        if (meta && meta.title === name) {
                            return meta;
                        }
                    }
                }
                
                throw new Error('Not found in root');
            }
            if (value && typeof value === 'object') return value;
            const resolved = resolveMetaFromId(value);
            if (resolved) return resolved.meta;
            return value;
        },
        readFile: async () => { throw new Error('Not implemented'); },
        changeDir: async (from, to) => {
            // Don't wait for original readyPromise when in shared folder
            if (currentDriveRt === driveInstances[0]?.rt && !isReady) await readyPromise;
            const cwd = normalize(from);
            if (cwd !== '/') throw new Error('Only root directory is supported');
            if (!to) throw new Error('Usage: cd <folder>');
            // Handle special paths
            if (to === '/') {
                // Switch back to the original drive
                currentDriveRt = driveInstances[0].rt;
                folderStack = [];
                currentFolder = null;
                return { path: '/', message: 'Changed to root folder' };
            }
            if (to === '..') {
                if (folderStack.length > 0) {
                    folderStack.pop();
                    currentFolder = folderStack.length ? folderStack[folderStack.length - 1].node : null;
                }
                if (!folderStack.length) {
                    // If we're in a shared folder and go up from root, go back to main drive
                    if (currentDriveRt !== driveInstances[0].rt) {
                        currentDriveRt = driveInstances[0].rt;
                        return { path: '/', message: 'Changed to root folder' };
                    }
                    return { path: '/', message: 'Changed to root folder' };
                }
                return { path: '/', message: 'Changed folder to ' + (folderStack[folderStack.length - 1].name || '(unknown)') };
            }
            const drive = getDriveObject();
            if (!drive) throw new Error('Folder does not exist');

            // Support multi-segment paths like "A/B/C"
            const raw = String(to);
            const abs = raw.startsWith('/');
            const segments = raw.split('/').filter(s => s.length > 0);
            if (abs) {
                folderStack = [];
                currentFolder = null;
            }

            let container = currentFolder || (drive && drive.root);
            if (!container) throw new Error('Folder does not exist');

            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                if (seg === '.') continue;
                if (seg === '..') {
                    if (folderStack.length > 0) {
                        folderStack.pop();
                        currentFolder = folderStack.length ? folderStack[folderStack.length - 1].node : null;
                    }
                    container = currentFolder || (drive && drive.root);
                    continue;
                }

                if (!Object.prototype.hasOwnProperty.call(container, seg)) {
                    // allow shared folder by title only if this is the last segment
                    if (i === segments.length - 1) {
                const byTitle = findSharedFolderByTitle(seg);
                if (byTitle) {
                    const title = byTitle.meta && (byTitle.meta.lastTitle || byTitle.meta.title) || seg;
                    const href = byTitle.meta && byTitle.meta.href ? byTitle.meta.href : '';
                    let fullUrl = href;
                    const currentBaseOrigin = getBaseOrigin();
                    try { fullUrl = new URL(href, currentBaseOrigin || undefined).toString(); } catch (_) { fullUrl = (currentBaseOrigin || '').replace(/\/?$/, '/') + href.replace(/^\//, ''); }
                    
                    // Check if we already have this drive loaded
                    let sharedRt = findRtByUrl(fullUrl);
                    if (!sharedRt) {
                        // Load the shared folder drive
                        const sharedWsUrl = wsURL; // Use the same websocket URL
                        sharedRt = getCryptPadDrive(fullUrl, sharedWsUrl);
                        driveInstances.push({ url: fullUrl, rt: sharedRt });
                        
                        // Wait for the shared folder to be ready
                        await new Promise((resolve, reject) => {
                            sharedRt.proxy.on('ready', resolve).on('error', reject);
                        });
                    }
                    
                    // Switch to the shared folder context
                    currentDriveRt = sharedRt;
                    folderStack = []; // Reset folder stack for shared folder
                    currentFolder = null;
                    
                    return { path: '/', message: 'Changed to shared folder: ' + title };
                }
                    }
                    throw new Error('Folder does not exist');
                }

                const value = container[seg];
                if (value && typeof value === 'object') {
                    // Navigate into standard folder
                    folderStack.push({ name: seg, node: value });
                    currentFolder = value;
                    container = value;
                } else {
                    // ID-like entry
                    const resolved = resolveMetaFromId(value);
                    if (!resolved) throw new Error('Folder does not exist');
                    if (resolved.kind === 'sharedFolder') {
                        // Only valid if terminal segment; load shared folder drive
                        if (i !== segments.length - 1) throw new Error('Folder does not exist');
                        const title = (resolved.meta && (resolved.meta.lastTitle || resolved.meta.title)) || seg;
                        const href = resolved.meta && resolved.meta.href ? resolved.meta.href : '';
                        let fullUrl = href;
                        try { fullUrl = new URL(href, baseOrigin || undefined).toString(); } catch (_) { fullUrl = (baseOrigin || '').replace(/\/?$/, '/') + href.replace(/^\//, ''); }
                        
                        // Check if we already have this drive loaded
                        let sharedRt = findRtByUrl(fullUrl);
                        if (!sharedRt) {
                            // Load the shared folder drive
                            const sharedWsUrl = wsURL; // Use the same websocket URL
                            sharedRt = getCryptPadDrive(fullUrl, sharedWsUrl);
                            driveInstances.push({ url: fullUrl, rt: sharedRt });
                            
                            // Wait for the shared folder to be ready
                            await new Promise((resolve, reject) => {
                                sharedRt.proxy.on('ready', resolve).on('error', reject);
                            });
                        }
                        
                        // Switch to the shared folder context
                        currentDriveRt = sharedRt;
                        folderStack = []; // Reset folder stack for shared folder
                        currentFolder = null;
                        
                        return { path: '/', message: 'Changed to shared folder: ' + title };
                    }
                    // files/documents cannot be navigated into
                    throw new Error('Folder does not exist');
                }
            }

            const finalName = folderStack.length ? folderStack[folderStack.length - 1].name : '/';
            const msg = folderStack.length ? ('Changed folder to ' + finalName) : 'Changed to root folder';
            return { path: '/', message: msg };
        },
        makeDir: async () => { throw new Error('Not implemented'); },
        mv: async (from, source, target) => {
            // Don't wait for original readyPromise when in shared folder
            if (currentDriveRt === driveInstances[0]?.rt && !isReady) await readyPromise;
            const cwd = normalize(from);
            if (cwd !== '/') throw new Error('Only root-level mv is implemented');
            if (!source) throw new Error('Usage: mv <source> <target>');
            if (!target) throw new Error('Usage: mv <source> <target>');
            
            const drive = getDriveObject();
            const container = currentFolder || (drive && drive.root);
            if (!container) throw new Error('Not found in root');
            
            // Find source document
            let sourceValue;
            if (Object.prototype.hasOwnProperty.call(container, source)) {
                sourceValue = container[source];
            } else {
                // Try to find by title in filesData (only for documents, not folders)
                const filesData = drive && drive.filesData;
                if (filesData) {
                    for (const [id, meta] of Object.entries(filesData)) {
                        if (meta && meta.title === source) {
                            // Check if this ID corresponds to a document (not a folder)
                            const containerValue = container[id];
                            if (containerValue && typeof containerValue !== 'object') {
                                sourceValue = id;
                                break;
                            }
                        }
                    }
                }
                if (!sourceValue) throw new Error('Source not found');
            }
            
            // Check if source is a document (not a folder)
            if (sourceValue && typeof sourceValue === 'object') {
                throw new Error('Cannot move folders');
            }
            
            // Find target folder
            let targetFolder;
            if (Object.prototype.hasOwnProperty.call(container, target)) {
                const targetValue = container[target];
                if (targetValue && typeof targetValue === 'object') {
                    targetFolder = targetValue;
                } else {
                    throw new Error('Target is not a folder');
                }
            } else {
                throw new Error('Target folder not found');
            }
            
            // Check if target is a standard folder (not shared folder)
            const sharedFolders = drive && drive.sharedFolders;
            if (sharedFolders) {
                for (const [id, meta] of Object.entries(sharedFolders)) {
                    if (id === target || (meta && (meta.lastTitle === target || meta.title === target))) {
                        throw new Error('Moving to shared folders is not implemented');
                    }
                }
            }
            
            // Move the document: remove from root and add to target folder
            delete container[source];
            targetFolder[source] = sourceValue;
            
            return { message: `Moved ${source} to ${target}` };
        },
        rename: async (from, oldName, newName) => {
            // Don't wait for original readyPromise when in shared folder
            if (currentDriveRt === driveInstances[0]?.rt && !isReady) await readyPromise;
            const cwd = normalize(from);
            if (cwd !== '/') throw new Error('Only root-level rename is implemented');
            if (!oldName) throw new Error('Usage: rename <oldName> <newName>');
            if (!newName) throw new Error('Usage: rename <oldName> <newName>');
            
            const drive = getDriveObject();
            const container = currentFolder || (drive && drive.root);
            if (!container) throw new Error('Not found in root');
            
            // Check if source folder exists
            if (!Object.prototype.hasOwnProperty.call(container, oldName)) {
                throw new Error('Source folder not found');
            }
            
            const sourceValue = container[oldName];
            
            // Check if source is a folder (object)
            if (!sourceValue || typeof sourceValue !== 'object') {
                throw new Error('Source is not a folder');
            }
            
            // Check if target name already exists
            if (Object.prototype.hasOwnProperty.call(container, newName)) {
                throw new Error('Target name already exists');
            }
            
            // Rename the folder: remove old name and add new name
            delete container[oldName];
            container[newName] = sourceValue;
            
            // Update folder stack if we're currently in the renamed folder
            if (folderStack.length > 0 && folderStack[folderStack.length - 1].name === oldName) {
                folderStack[folderStack.length - 1].name = newName;
            }
            
            return { message: `Renamed folder ${oldName} to ${newName}` };
        },
        download: async (from, name, localPath) => {
            // Don't wait for original readyPromise when in shared folder
            if (currentDriveRt === driveInstances[0]?.rt && !isReady) await readyPromise;
            const cwd = normalize(from);
            if (cwd !== '/') throw new Error('Only root-level download is implemented');
            if (!name) throw new Error('Usage: download <name> [localPath]');
            
            const drive = getDriveObject();
            const container = currentFolder || (drive && drive.root);
            if (!container) throw new Error('Not found in root');
            
            // Find source document
            let value;
            if (Object.prototype.hasOwnProperty.call(container, name)) {
                value = container[name];
            } else {
                // Try to find by title in filesData (only for documents, not folders)
                const filesData = drive && drive.filesData;
                if (filesData) {
                    // First, get all document IDs that are in the current folder
                    const folderDocumentIds = [];
                    for (const [folderName, folderValue] of Object.entries(container)) {
                        if (typeof folderValue !== 'object') {
                            folderDocumentIds.push(folderName);
                        }
                    }
                    
                    // Then, for each document in the folder, check if its title matches
                    for (const id of folderDocumentIds) {
                        const meta = filesData[id];
                        if (meta && meta.title === name) {
                            value = id;
                            break;
                        }
                    }
                }
                if (!value) throw new Error('Source not found');
            }
            
            // Check if source is a document (not a folder)
            if (value && typeof value === 'object') {
                throw new Error('Cannot download folders');
            }
            
            const resolved = resolveMetaFromId(value);
            if (!resolved) throw new Error('Not found');
            if (resolved.kind !== 'file') throw new Error('Not a file');
            
            // Get document metadata
            const meta = resolved.meta;
            const title = meta && meta.title ? meta.title : name;
            
            // Generate local file path
            const fs = require('fs');
            const path = require('path');
            
            let fileName = localPath || title;
            
            // Ensure file has an extension based on content type
            if (!path.extname(fileName)) {
                // Try to determine extension from href
                const href = meta && meta.roHref ? meta.roHref : '';
                if (href.includes('/presentation/')) {
                    fileName += '.html';
                } else if (href.includes('/sheet/')) {
                    fileName += '.html';
                } else if (href.includes('/kanban/')) {
                    fileName += '.html';
                } else if (href.includes('/whiteboard/')) {
                    fileName += '.html';
                } else {
                    fileName += '.txt';
                }
            }
            
            // Create directory structure if needed
            const dir = path.dirname(fileName);
            if (dir !== '.') {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            // Get the pad content
            const href = meta && meta.roHref ? meta.roHref : '';
            let fullUrl = href;
            const currentBaseOrigin = getBaseOrigin();
            try { 
                fullUrl = new URL(href, currentBaseOrigin || undefined).toString(); 
            } catch (_) { 
                fullUrl = (currentBaseOrigin || '').replace(/\/?$/, '/') + String(href).replace(/^\//, ''); 
            }
            
            const wsUrl = wsURL;
            
            // Download the content
            const content = await new Promise((resolve, reject) => {
                let chainpad;
                let resolved = false;
                let rtPad;
                
                global.document = dom.window.document;
                
                const safeParseDoc = () => {
                    if (!chainpad) { return; }
                    try {
                        let doc = JSON.parse(chainpad.getUserDoc());
                        if (Array.isArray(doc)) {
                            let parsed = doc.slice(0,-1);
                            return HyperJson.toDOM(parsed).textContent;
                        }
                        
                        // Handle different content types
                        if (doc && typeof doc === 'object') {
                            // Check if it's HTML content (contains HTML tags)
                            const content = doc.content || doc;
                            if (typeof content === 'string' && (content.includes('<') && content.includes('>'))) {
                                // It's HTML content, return as-is
                                return content;
                            } else if (typeof content === 'object') {
                                // It's a JSON object, stringify it
                                return JSON.stringify(content, null, 2);
                            } else {
                                // It's a string, return as-is
                                return content;
                            }
                        }
                        
                        return doc.content || doc;
                    } catch (e) {
                        console.error(e);
                        return 'ERROR';
                    }
                };
                
                const tryResolve = () => {
                    if (resolved) return;
                    const content = safeParseDoc();
                    if (content && content !== '') {
                        resolved = true;
                        try { if (rtPad && typeof rtPad.stop === 'function') rtPad.stop(); } catch (_) {}
                        resolve(content);
                    }
                };
                
                const onReady = (info) => {
                    chainpad = info.realtime;
                    tryResolve();
                };
                
                rtPad = getPad(fullUrl, wsUrl, { onReady });
                
                // Poll briefly in case onRemote is not emitted promptly
                const poll = setInterval(() => {
                    tryResolve();
                    if (resolved) clearInterval(poll);
                }, 300);
                
                // Timeout fallback
                setTimeout(() => {
                    if (!resolved) {
                        clearInterval(poll);
                        try { if (rtPad && typeof rtPad.stop === 'function') rtPad.stop(); } catch (_) {}
                        reject(new Error('Download timeout'));
                        resolved = true;
                    }
                }, 20000);
            });
            
            // Write content to file
            fs.writeFileSync(fileName, content, 'utf8');
            
            return { message: `Downloaded ${title} to ${fileName}` };
        },
        create: async (from, padType, title) => {
            // Don't wait for original readyPromise when in shared folder
            if (currentDriveRt === driveInstances[0]?.rt && !isReady) await readyPromise;
            const cwd = normalize(from);
            if (cwd !== '/') throw new Error('Only root-level create is implemented');
            if (!padType) throw new Error('Usage: create <padType> <title>');
            if (!title) throw new Error('Usage: create <padType> <title>');
            
            const drive = getDriveObject();
            const container = currentFolder || (drive && drive.root);
            if (!container) throw new Error('Not found in root');
            
            // Validate pad type
            const validPadTypes = ['pad', 'code', 'kanban'];
            if (!validPadTypes.includes(padType)) {
                throw new Error(`Invalid pad type. Valid types: ${validPadTypes.join(', ')}`);
            }
            
            // Check if title already exists in current folder
            for (const [name, value] of Object.entries(container)) {
                if (typeof value !== 'object') {
                    // Check if this is a document with the same title
                    const filesData = drive && drive.filesData;
                    if (filesData && filesData[name] && filesData[name].title === title) {
                        throw new Error('A document with this title already exists');
                    }
                }
            }
            
            // PLACEHOLDER 1 - Prepare JSON content to add to drive
            // Generate new document ID using crypto random bytes
            const newDocumentId = Crypto.randomBytes(16).toString('hex');
            
            // Get current user's public key for owners array
            const currentUser = currentDriveRt && currentDriveRt.proxy && currentDriveRt.proxy['cryptpad.username'];
            const currentUserKey = currentDriveRt && currentDriveRt.proxy && currentDriveRt.proxy.curvePublic;
            
            // Generate channel ID (32 character hex string)
            const generateChannelId = () => {
                const chars = '0123456789abcdef';
                let result = '';
                for (let i = 0; i < 32; i++) {
                    result += chars[Math.floor(Math.random() * chars.length)];
                }
                return result;
            };
            
            const channelId = generateChannelId();
            const currentTime = Date.now();
            
            // Generate random value for link between root and filesData
            const randomValue = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
            
            // Create metadata object following the provided structure
            const newDocumentMeta = {
                atime: currentTime,
                channel: channelId,
                ctime: currentTime,
                href: `/${padType}/#/2/${padType}/edit/PLACEHOLDER_PAD_ID/`,
                owners: currentUserKey ? [currentUserKey] : [],
                roHref: `/${padType}/#/2/${padType}/view/PLACEHOLDER_VIEW_ID/`,
                title: title
            };
            
            
            // Create the pad using makePad function
            const baseOrigin = getBaseOrigin();
            const wsURL = options.wsURL;
            
            // Prepare default content based on pad type
            let defaultContent;
            switch (padType) {
                case 'pad':
                    defaultContent = '{}';
                    break;
                case 'code':
                    defaultContent = '{"content":"// New code file\\n"}';
                    break;
                case 'kanban':
                    defaultContent = '{"content":"{\\"columns\\":[]}"}';
                    break;
                default:
                    defaultContent = '{"content":""}';
            }
            
            console.log('Creating pad...');
            
            // Create the pad and wait for completion
            return new Promise((resolve, reject) => {
                makePad(padType, defaultContent, wsURL, baseOrigin, title, (err, padUrl) => {
                    if (err) {
                        console.error('Error creating pad:', err);
                        reject(new Error(`Failed to create pad: ${err}`));
                        return;
                    }
                    
                    console.log('Pad created successfully:', padUrl);
                    
                    // Extract relative paths from the full URLs
                    const hrefMatch = padUrl.match(/https?:\/\/[^\/]+(.+)/);
                    let href = hrefMatch ? hrefMatch[1] : padUrl;
                    // Ensure href ends with a slash
                    if (!href.endsWith('/')) {
                        href += '/';
                    }
                    
                    // Use the same URL for both href and roHref
                    const roHref = href;
                    
                    // Update metadata with relative URLs
                    newDocumentMeta.href = href;
                    newDocumentMeta.roHref = roHref;
                    
                    // Update the drive structure
                    const drive = getDriveObject();
                    if (drive && drive.filesData) {
                        // Add metadata to filesData using the random value as key
                        drive.filesData[randomValue] = newDocumentMeta;
                    }
                    if (container) {
                        // Add entry to folder using the 32-char hex ID as key and random value as value
                        container[newDocumentId] = randomValue;
                    }
                    
                    // Display the updated drive JSON structure
                    console.log('\n=== Updated Drive Structure ===');
                    console.log('Current folder entries:');
                    console.log(JSON.stringify(container, null, 2));
                    console.log('\nFilesData entries:');
                    console.log(JSON.stringify(drive.filesData, null, 2));
                    console.log('================================\n');
                    
                    resolve({
                        message: `Created ${padType} pad: "${title}"`,
                        data: {
                            documentId: newDocumentId,
                            metadata: newDocumentMeta,
                            padUrl: padUrl,
                            padType: padType,
                            title: title,
                            channelId: channelId,
                            randomValue: randomValue,
                            currentUser: currentUser,
                            currentUserKey: currentUserKey
                        }
                    });
                });
            });
        },
        getPath,
        complete: async (path, partial) => {
            // Don't wait for original readyPromise when in shared folder
            if (currentDriveRt === driveInstances[0]?.rt && !isReady) await readyPromise;
            const p = normalize(path);
            if (p !== '/') return [];
            
            const drive = getDriveObject();
            const container = currentFolder || (drive && drive.root);
            if (!container) return [];
            
            const names = Object.keys(container);
            return names.filter(name => name.startsWith(partial));
        },
        completeCd: async (path, partial) => {
            // Don't wait for original readyPromise when in shared folder
            if (currentDriveRt === driveInstances[0]?.rt && !isReady) await readyPromise;
            const p = normalize(path);
            if (p !== '/') return [];
            
            const drive = getDriveObject();
            const container = currentFolder || (drive && drive.root);
            if (!container) return [];
            
            const completions = [];
            
            // Add standard folders (objects in container)
            for (const [name, value] of Object.entries(container)) {
                if (name.startsWith(partial)) {
                    completions.push(name);
                }
            }
            
            // Add shared folders by ID and title
            const sharedFolders = drive && drive.sharedFolders;
            if (sharedFolders) {
                for (const [id, meta] of Object.entries(sharedFolders)) {
                    if (id.startsWith(partial)) {
                        completions.push(id);
                    }
                    if (meta && meta.lastTitle && meta.lastTitle.startsWith(partial)) {
                        completions.push(meta.lastTitle);
                    }
                    if (meta && meta.title && meta.title.startsWith(partial)) {
                        completions.push(meta.title);
                    }
                }
            }
            
            return completions;
        },
        findRtByUrl,
        driveInstances,
        getDriveObject,
        currentFolder,
        getCurrentContainer: () => {
            const drive = getDriveObject();
            return currentFolder || (drive && drive.root);
        },
        ready: () => readyPromise,
    };
};



