/* eslint-disable code-import-patterns */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { ARTVLogger } from 'vs/editor/contrib/rtv/RTVInterfaces';

/*
 * Things to log:
 *   - How many requests?
 *   - How often?
 *   - How many fail?
 *   - Attempts to synthesize dependent loops?
 *   - How many examples do they provide?
 */
export class RTVLogger extends ARTVLogger {
	// States for various things we need to log
	private logDir: string;
	private logCounter: number = 0;
	private currentFileName: string = 'unknown';
	private readonly logFile: string;

	constructor(editor: ICodeEditor) {
		super(editor);

		// Build output dir name
		let dir = process.env['LOG_DIR'];

		if (!dir) {
			dir = os.tmpdir() + path.sep;
		} else {
			if (!dir.endsWith(path.sep)) {
				dir += path.sep;
			}

			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir);
			}
		}

		// Build an fs-safe date/time:
		let now = new Date();
		dir += `snippy_log_${now.getMonth() + 1}-${now.getDate()}_${now.getHours()}-${now.getMinutes()}_${now.getSeconds()}`;

		// Don't overwrite existing logs!
		if (fs.existsSync(dir!!)) {
			console.error('Two log dirs created at the exact same time. This should not happen.');
			let counter = 0;
			dir = dir + '_' + counter;
			while (fs.existsSync(dir)) {
				dir = dir.substring(0, dir.length - 1) + counter++;
			}
		}

		this.logDir = dir! + path.sep;
		fs.mkdirSync(this.logDir);
		this.logFile = 'snippy_plus.log';
	}

	protected log(code: string, msg?: string): number {
		this.logCounter++;
		let str: string;

		if (msg) {
			msg = msg.replace(/\n/g, '\\n');
			str = `${this.logCounter},${this.now()},${this.getCurrentFileName()},${code},${msg}`;
		} else {
			str = `${this.logCounter},${this.now()},${this.getCurrentFileName()},${code}`;
		}

		console.log(str);
		fs.appendFileSync(this.logDir + this.logFile, str + '\n');
		return this.logCounter;
	}

	protected write(file: string, content: string): void {
		fs.writeFileSync(this.logDir + file, content);
	}

	private now(): number {
		return new Date().getTime();
	}

	private getCurrentFileName() {
		let rs = this.editor.getModel()?.uri.toString();

		if (rs) {
			if (!rs.includes(this.currentFileName)) {
				let start = rs.lastIndexOf('/') + 1;
				let end = rs.length - start - 3;
				this.currentFileName = rs.substr(start, end);
			}
		} else {
			this.currentFileName = 'unknown';
		}

		return this.currentFileName;
	}
}
