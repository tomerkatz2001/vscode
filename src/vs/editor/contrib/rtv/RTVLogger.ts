import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

/*
 * Things to log:
 *   - How many requests?
 *   - How often?
 *   - How many fail?
 *   - Attempts to synthesize dependent loops?
 *   - How many examples do they provide?
 */
// TODO Everything is sync right now. We should convert
// it to async calls to minimize any waiting for logging.
export class RTVLogger {
	// States for various things we need to log
	private synthRequestCounter: number = 0;
	private logDir: string;
	private currentFileName: string = 'unknown';
	private readonly logFile: string;

	private editorInFocus: boolean = false;
	private projectionBoxInFocus: boolean = false;

	private now() : number {
		return new Date().getTime();
	}

	private getCurrentFileName() {
		let rs = this._editor.getModel()?.uri.toString();

		if (rs) {
			if (!rs.includes(this.currentFileName)) {
				let start = rs.lastIndexOf(path.sep) + 1;
				let end = rs.length - start - 3;
				this.currentFileName = rs.substr(start, end);
			}
		} else {
			this.currentFileName = 'unknown';
		}

		return this.currentFileName;
	}

    private log(code: string, msg?: string): void {
		let str: string;

		if (msg) {
			str = `${this.now()},${this.getCurrentFileName()},${code},${msg}`;
		} else {
			str = `${this.now()},${this.getCurrentFileName()},${code}`;
		}

		console.log(str);
        fs.appendFileSync(this.logDir + this.logFile, str + '\n');
    }

    private write(file: string, content: any): void {
		fs.writeFileSync(this.logDir + file, String(content));
    }

	constructor(private readonly _editor: ICodeEditor)
	{
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

		dir += 'snippy_log_' + new Date().getTime();

		// Don't overwrite existing logs!
		if (fs.existsSync(dir)) {
			console.error('Two log dirs created at the exact same time. This should not happen.');
			let counter = 0;
			dir = dir + '_' + counter;
			while (fs.existsSync(dir)) {
				dir = dir.substring(0, dir.length - 1) + counter++;
			}
		}

		this.logDir = dir! + path.sep;
		fs.mkdirSync(this.logDir);
		this.logFile = 'snippy.log';

		// Add event for when editor is in focus
		this._editor.onDidFocusEditorText(() => this.editorFocus());
		this._editor.onDidFocusEditorWidget(() => this.editorFocus());
	}

	public dispose() {
		this.log('log.end');
	}

    public synthStart(problem: any, examples: number, lineno: number) {
		this.log(`synth.start.${this.synthRequestCounter}.${lineno}.${examples}`);

		this.write(
			`${this.synthRequestCounter}_synth_example.json`,
			JSON.stringify(problem, null, 2));
		this.write(
			`${this.synthRequestCounter}_editor_state.py`,
			this._editor.getModel()?.getLinesContent().join('\n'));

		this.synthRequestCounter++;
	}

	public synthOut(msg: string) {
		if (msg.endsWith('\n')) {
			msg = msg.substr(0, msg.length - 1);
		}

		this.log('synth.stdout', msg);
	}

	public synthErr(msg: string) {
		if (msg.endsWith('\n')) {
			msg = msg.substr(0, msg.length - 1);
		}

		this.log('synth.sterr', msg);
	}

	public synthEnd(exitCode: number, result?: string) {
		if (exitCode === 0) {
			this.log(`synth.end.${this.synthRequestCounter - 1}.${exitCode}`, result);
		} else {
			this.log(`synth.end.${this.synthRequestCounter - 1}.${exitCode}`);
		}
	}

	public editorFocus() {
		if (!this.editorInFocus || this.currentFileName !== this.getCurrentFileName()) {
			this.log('focus.editor');
			this.editorInFocus = true;
			this.projectionBoxInFocus = false;
		}
	}

	public projectionBoxFocus() {
		if (!this.projectionBoxInFocus || this.currentFileName !== this.getCurrentFileName()) {
			this.log('focus.projectionBox');
			this.editorInFocus = false;
			this.projectionBoxInFocus = true;
		}
	}
}
