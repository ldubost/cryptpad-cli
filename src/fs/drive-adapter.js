// CryptPad drive adapter exposing the same interface as memory adapter
// Currently implements list('/') by reading from rt.proxy.drive.root
const { getPad } = require('../cryptpad/pad');
const { getCryptPadDrive } = require('../cryptpad/drive');

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

    function getRootEntries() {
        const container = (currentFolder) || (currentDriveRt && currentDriveRt.proxy && currentDriveRt.proxy.drive && currentDriveRt.proxy.drive.root);
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
                            try { 
                                fullUrl = new URL(href, baseOrigin || undefined).toString(); 
                            } catch (_) { 
                                fullUrl = (baseOrigin || '').replace(/\/?$/, '/') + href.replace(/^\//, ''); 
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
        const drive = currentDriveRt && currentDriveRt.proxy && currentDriveRt.proxy.drive;
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
        const drive = currentDriveRt && currentDriveRt.proxy && currentDriveRt.proxy.drive;
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
            if (!isReady) await readyPromise;
            const p = normalize(path);
            if (p !== '/') throw new Error('Only root listing is implemented');
            return getRootEntries();
        },
        listDisplay: async (path) => {
            if (!isReady) await readyPromise;
            const p = normalize(path);
            if (p !== '/') throw new Error('Only root listing is implemented');
            const drive = currentDriveRt && currentDriveRt.proxy && currentDriveRt.proxy.drive;
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
            const drive = currentDriveRt && currentDriveRt.proxy && currentDriveRt.proxy.drive;
            const container = (currentFolder) || (drive && drive.root);
            if (!container) throw new Error('Not found');
            if (!Object.prototype.hasOwnProperty.call(container, name)) throw new Error('Not found');
            const value = container[name];
            if (value && typeof value === 'object') throw new Error('Not a file');
            const resolved = resolveMetaFromId(value);
            if (!resolved) throw new Error('Not found');
            if (resolved.kind !== 'file') throw new Error('Not a file');
            const href = resolved.meta && resolved.meta.href ? resolved.meta.href : '';
            let fullUrl = href;
            try { fullUrl = new URL(href, baseOrigin || undefined).toString(); } catch (_) { fullUrl = (baseOrigin || '').replace(/\/?$/, '/') + String(href).replace(/^\//, ''); }

            // Use provided websocket URL from adapter options
            const wsUrl = wsURL;
            return await new Promise((resolve) => {
                let chainpad;
                let resolved = false;
                let rtPad;

                const safeParseDoc = () => {
                    try {
                        const doc = chainpad && typeof chainpad.getUserDoc === 'function' ? chainpad.getUserDoc() : '';
                        if (!doc) return null;
                        try {
                            const parsed = JSON.parse(doc);
                            return parsed && parsed.content !== undefined ? parsed.content : doc;
                        } catch (_) {
                            return doc;
                        }
                    } catch (_) {
                        return 'ERROR';
                    }
                };

                const tryResolve = () => {
                    if (resolved) return;
                    const content = safeParseDoc();
                    if (content && content !== '') {
                        print("Content is: " + content);
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
            if (!isReady) await readyPromise;
            const cwd = normalize(from);
            if (cwd !== '/') throw new Error('Only root info is implemented');
            if (!name) throw new Error('Usage: info <name>');
            const drive = currentDriveRt && currentDriveRt.proxy && currentDriveRt.proxy.drive;
            const container = currentFolder || (drive && drive.root);
            if (!container) throw new Error('Not found in root');
            let value;
            if (Object.prototype.hasOwnProperty.call(container, name)) {
                value = container[name];
            } else {
                const byTitle = findSharedFolderByTitle(name);
                if (byTitle) return byTitle.meta;
                throw new Error('Not found in root');
            }
            if (value && typeof value === 'object') return value;
            const resolved = resolveMetaFromId(value);
            if (resolved) return resolved.meta;
            return value;
        },
        readFile: async () => { throw new Error('Not implemented'); },
        changeDir: async (from, to) => {
            if (!isReady) await readyPromise;
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
            const drive = currentDriveRt && currentDriveRt.proxy && currentDriveRt.proxy.drive;
            if (!drive) throw new Error('Folder does not exist');

            // Support multi-segment paths like "A/B/C"
            const raw = String(to);
            const abs = raw.startsWith('/');
            const segments = raw.split('/').filter(s => s.length > 0);
            if (abs) {
                folderStack = [];
                currentFolder = null;
            }

            let container = currentFolder || drive.root;
            if (!container) throw new Error('Folder does not exist');

            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                if (seg === '.') continue;
                if (seg === '..') {
                    if (folderStack.length > 0) {
                        folderStack.pop();
                        currentFolder = folderStack.length ? folderStack[folderStack.length - 1].node : null;
                    }
                    container = currentFolder || drive.root;
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
        getPath,
        findRtByUrl,
        driveInstances,
        ready: () => readyPromise,
    };
};



