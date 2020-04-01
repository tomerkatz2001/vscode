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

	private now() : string {
		let now = new Date();

		let month = now.getMonth();
		let day = now.getDate();
		let year = now.getFullYear();

		let hour = String('00' + now.getHours()).slice(-2);
		let minute = String('00' + now.getMinutes()).slice(-2);
		let seconds = String('00' + now.getSeconds()).slice(-2);
		let millis = String('000' + now.getMilliseconds()).slice(-3);

		return `${month}/${day}/${year} ${hour}:${minute}:${seconds}.${millis}`;
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

    private log(msg: string): void {
		let str = `(${this.now()}) [${this.getCurrentFileName()}] ${msg}`;
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
		this.log('Disposing logger...');
	}

    public synthStart(problem: any, examples: number, lineno: number) {
		this.log(`Starting synthesis task #${this.synthRequestCounter} with ${examples} example(s) for line ${lineno}`);

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

		this.log(`Synthesizer stdout: ${msg}`);
	}

	public synthErr(msg: string) {
		if (msg.endsWith('\n')) {
			msg = msg.substr(0, msg.length - 1);
		}

		this.log(`Synthesizer sdterr: ${msg}`);
	}

	public synthEnd(exitCode: number, result?: string) {
		if (exitCode === 0) {
			this.log(`Synthesis task #${this.synthRequestCounter - 1} ended with code ${exitCode}: ${result}`);
		} else {
			this.log(`Synthesis task failed with exit code ${exitCode})`);
		}
	}

	public editorFocus() {
		if (!this.editorInFocus || this.currentFileName !== this.getCurrentFileName()) {
			this.log('Code editor in focus');
			this.editorInFocus = true;
			this.projectionBoxInFocus = false;
		}
	}

	public projectionBoxFocus() {
		if (!this.projectionBoxInFocus || this.currentFileName !== this.getCurrentFileName()) {
			this.log('Projection box in focus');
			this.editorInFocus = false;
			this.projectionBoxInFocus = true;
		}
	}
}
