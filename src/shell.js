const readline = require('readline');

function createShell(filesystemAdapter, options = {}) {
    const env = {
        fs: filesystemAdapter,
        cwd: '/',
        prompt: options.prompt || 'drive> ',
        commands: {},
        stdout: options.stdout || process.stdout,
        stderr: options.stderr || process.stderr,
    };

    const commands = require('./commands')(env);
    env.commands = commands;

    function print(line) {
        env.stdout.write(line + '\n');
    }

    function parseArgs(line) {
        const args = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = '';
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (!inQuotes) {
                if (char === '"' || char === "'") {
                    inQuotes = true;
                    quoteChar = char;
                } else if (char === '\\' && i + 1 < line.length) {
                    // Handle escaped characters
                    current += line[i + 1];
                    i++; // Skip next character
                } else if (/\s/.test(char)) {
                    if (current) {
                        args.push(current);
                        current = '';
                    }
                } else {
                    current += char;
                }
            } else {
                if (char === quoteChar) {
                    inQuotes = false;
                    quoteChar = '';
                } else if (char === '\\' && i + 1 < line.length) {
                    // Handle escaped characters inside quotes
                    current += line[i + 1];
                    i++; // Skip next character
                } else {
                    current += char;
                }
            }
        }
        
        if (current) {
            args.push(current);
        }
        
        return args;
    }

    function exec(line) {
        const trimmed = (line || '').trim();
        if (!trimmed) return;
        const args = parseArgs(trimmed);
        const [cmd, ...cmdArgs] = args;
        const handler = env.commands[cmd];
        if (!handler) {
            print(`Unknown command: ${cmd}. Type 'help'`);
            return;
        }
        Promise.resolve(handler(cmdArgs))
            .catch(err => {
                print(String(err && err.message ? err.message : err));
            });
    }

    function start() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: env.prompt,
            historySize: 200,
            completer: (line) => {
                const args = parseArgs(line.trim());
                const cmd = args[0];
                const partial = args[args.length - 1] || '';
                
                // Command completion
                if (args.length === 1) {
                    const cmds = Object.keys(env.commands);
                    const hits = cmds.filter(c => c.startsWith(cmd));
                    return [hits.length ? hits : cmds, line];
                }
                
                // File/folder completion for specific commands
                if (['ls'].includes(cmd)) {
                    try {
                        if (typeof env.fs.complete === 'function') {
                            // Use synchronous completion by getting current directory contents
                            const drive = env.fs.getDriveObject ? env.fs.getDriveObject() : null;
                            if (drive) {
                                const container = env.fs.currentFolder || (drive && drive.root);
                                if (container) {
                                    const names = Object.keys(container);
                                    const completions = names.filter(name => name.startsWith(partial));
                                    return [completions, partial];
                                }
                            }
                        }
                    } catch (err) {
                        // Ignore completion errors
                    }
                }
                
                // Special completion for info command (includes document titles)
                if (cmd === 'info') {
                    try {
                        const drive = env.fs.getDriveObject ? env.fs.getDriveObject() : null;
                        if (drive) {
                            const container = env.fs.getCurrentContainer ? env.fs.getCurrentContainer() : (drive && drive.root);
                            if (container) {
                                const completions = [];
                                
                                // Add all items (folders, documents, shared folders)
                                for (const [name, value] of Object.entries(container)) {
                                    if (name.startsWith(partial)) {
                                        completions.push(name);
                                    }
                                }
                                
                                // Add document titles from filesData (only for items in current folder)
                                const filesData = drive && drive.filesData;
                                if (filesData) {
                                    // First, get all document IDs that are in the current folder
                                    const folderDocumentIds = [];
                                    for (const [name, value] of Object.entries(container)) {
                                        if (typeof value !== 'object') {
                                            folderDocumentIds.push(name);
                                        }
                                    }
                                    
                                    // Then, for each document in the folder, check if its title matches
                                    for (const id of folderDocumentIds) {
                                        const meta = filesData[id];
                                        if (meta && meta.title && meta.title.startsWith(partial)) {
                                            completions.push(meta.title);
                                        }
                                    }
                                }
                                
                                // Add shared folder titles (only at root level)
                                const isAtRoot = !env.fs.getCurrentContainer || env.fs.getCurrentContainer() === (drive && drive.root);
                                if (isAtRoot) {
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
                                }
                                
                                return [completions, partial];
                            }
                        }
                    } catch (err) {
                        // Ignore completion errors
                    }
                }
                
                // Special completion for cat command (includes document titles)
                if (cmd === 'cat') {
                    try {
                        const drive = env.fs.getDriveObject ? env.fs.getDriveObject() : null;
                        if (drive) {
                            const container = env.fs.getCurrentContainer ? env.fs.getCurrentContainer() : (drive && drive.root);
                            if (container) {
                                const completions = [];
                                
                                // Add document names (non-objects in container)
                                for (const [name, value] of Object.entries(container)) {
                                    if (name.startsWith(partial)) {
                                        completions.push(name);
                                    }
                                }
                                
                                // Add document titles from filesData (only for documents in current folder)
                                const filesData = drive && drive.filesData;
                                if (filesData) {
                                    // First, get all document IDs that are in the current folder
                                    const folderDocumentIds = [];
                                    for (const [name, value] of Object.entries(container)) {
                                        if (typeof value !== 'object') {
                                            folderDocumentIds.push(name);
                                        }
                                    }
                                    
                                    // Then, for each document in the folder, check if its title matches
                                    for (const id of folderDocumentIds) {
                                        const meta = filesData[id];
                                        if (meta && meta.title && meta.title.startsWith(partial)) {
                                            completions.push(meta.title);
                                        }
                                    }
                                }
                                
                                return [completions, partial];
                            }
                        }
                    } catch (err) {
                        // Ignore completion errors
                    }
                }
                
                // Special completion for mv command
                if (cmd === 'mv') {
                    try {
                        const drive = env.fs.getDriveObject ? env.fs.getDriveObject() : null;
                        if (drive) {
                            const container = env.fs.getCurrentContainer ? env.fs.getCurrentContainer() : (drive && drive.root);
                            if (container) {
                                const completions = [];
                                
                                // For first argument (source), show documents only
                                if (args.length === 2) {
                                    // Add document names (non-objects in container)
                                    for (const [name, value] of Object.entries(container)) {
                                        if (name.startsWith(partial) && typeof value !== 'object') {
                                            completions.push(name);
                                        }
                                    }
                                    
                                    // Add document titles from filesData (only for documents in current folder)
                                    const filesData = drive && drive.filesData;
                                    if (filesData) {
                                        // First, get all document IDs that are in the current folder
                                        const folderDocumentIds = [];
                                        for (const [name, value] of Object.entries(container)) {
                                            if (typeof value !== 'object') {
                                                folderDocumentIds.push(name);
                                            }
                                        }
                                        
                                        // Then, for each document in the folder, check if its title matches
                                        for (const id of folderDocumentIds) {
                                            const meta = filesData[id];
                                            if (meta && meta.title && meta.title.startsWith(partial)) {
                                                completions.push(meta.title);
                                            }
                                        }
                                    }
                                }
                                
                                // For second argument (target), show folders only
                                if (args.length === 3) {
                                    // Add folder names (objects in container)
                                    for (const [name, value] of Object.entries(container)) {
                                        if (name.startsWith(partial) && typeof value === 'object') {
                                            completions.push(name);
                                        }
                                    }
                                }
                                
                                return [completions, partial];
                            }
                        }
                    } catch (err) {
                        // Ignore completion errors
                    }
                }
                
                // Special completion for create command
                if (cmd === 'create') {
                    try {
                        // For first argument (padType), show valid pad types
                        if (args.length === 2) {
                            const validPadTypes = ['pad', 'code', 'kanban'];
                            const completions = validPadTypes.filter(type => type.startsWith(partial));
                            return [completions, partial];
                        }
                        
                        // For second argument (title), no completion (user types title)
                        if (args.length === 3) {
                            return [[], partial];
                        }
                    } catch (err) {
                        // Ignore completion errors
                    }
                }
                
                // Special completion for download command
                if (cmd === 'download') {
                    try {
                        const drive = env.fs.getDriveObject ? env.fs.getDriveObject() : null;
                        if (drive) {
                            const container = env.fs.getCurrentContainer ? env.fs.getCurrentContainer() : (drive && drive.root);
                            if (container) {
                                const completions = [];
                                
                                // For first argument (name), show documents only
                                if (args.length === 2) {
                                    // Add document names (non-objects in container)
                                    for (const [name, value] of Object.entries(container)) {
                                        if (name.startsWith(partial) && typeof value !== 'object') {
                                            completions.push(name);
                                        }
                                    }
                                    
                                    // Add document titles from filesData (only for documents in current folder)
                                    const filesData = drive && drive.filesData;
                                    if (filesData) {
                                        // First, get all document IDs that are in the current folder
                                        const folderDocumentIds = [];
                                        for (const [name, value] of Object.entries(container)) {
                                            if (typeof value !== 'object') {
                                                folderDocumentIds.push(name);
                                            }
                                        }
                                        
                                        // Then, for each document in the folder, check if its title matches
                                        for (const id of folderDocumentIds) {
                                            const meta = filesData[id];
                                            if (meta && meta.title && meta.title.startsWith(partial)) {
                                                completions.push(meta.title);
                                            }
                                        }
                                    }
                                }
                                
                                // For second argument (localPath), no completion (user types path)
                                if (args.length === 3) {
                                    return [[], partial];
                                }
                                
                                return [completions, partial];
                            }
                        }
                    } catch (err) {
                        // Ignore completion errors
                    }
                }
                
                // Special completion for rename command
                if (cmd === 'rename') {
                    try {
                        const drive = env.fs.getDriveObject ? env.fs.getDriveObject() : null;
                        if (drive) {
                            const container = env.fs.getCurrentContainer ? env.fs.getCurrentContainer() : (drive && drive.root);
                            if (container) {
                                const completions = [];
                                
                                // For first argument (oldName), show folders only
                                if (args.length === 2) {
                                    // Add folder names (objects in container)
                                    for (const [name, value] of Object.entries(container)) {
                                        if (name.startsWith(partial) && typeof value === 'object') {
                                            completions.push(name);
                                        }
                                    }
                                }
                                
                                // For second argument (newName), no completion (user types new name)
                                if (args.length === 3) {
                                    return [[], partial];
                                }
                                
                                return [completions, partial];
                            }
                        }
                    } catch (err) {
                        // Ignore completion errors
                    }
                }
                
                // Special completion for cd command (includes shared folder titles)
                if (cmd === 'cd') {
                    try {
                        const drive = env.fs.getDriveObject ? env.fs.getDriveObject() : null;
                        if (drive) {
                            const container = env.fs.getCurrentContainer ? env.fs.getCurrentContainer() : (drive && drive.root);
                            if (container) {
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
                                
                                return [completions, partial];
                            }
                        }
                    } catch (err) {
                        // Ignore completion errors
                    }
                }
                
                return [[], line];
            }
        });

        rl.on('line', (line) => {
            exec(line);
            rl.prompt();
        });

        rl.on('close', () => {
            process.exit(0);
        });

        rl.prompt();
    }

    return { start, exec, env };
}

module.exports = { createShell };



