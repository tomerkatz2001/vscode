import { IRTVLogger } from 'vs/editor/contrib/rtv/RTVInterfaces';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

export class RTVLogger implements IRTVLogger {
	// States for various things we need to log
	private synthRequestCounter: number = 0;
	private currentFileName: string = 'unknown';

	private now(): number {
		return new Date().getTime();
	}

	private getCurrentFileName() {
		let rs = this._editor.getModel()?.uri.toString();

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

	private log(code: string, msg?: string): void {
		let str: string;

		if (msg) {
			msg = msg.replace(/\n/g, '\\n');
			str = `${this.now()},${this.getCurrentFileName()},${code},${msg}`;
		} else {
			str = `${this.now()},${this.getCurrentFileName()},${code}`;
		}

		// We need this for CSRF protection on the server
		const csrfInput = document.getElementById('csrf-parameter') as HTMLInputElement;
		const csrfToken = csrfInput.value;
		const csrfHeaderName = csrfInput.name;

		const headers = new Headers();
		headers.append('Content-Type', 'text/plain;charset=UTF-8');
		headers.append(csrfHeaderName, csrfToken);

		fetch(
			'/log',
			{
				method: 'POST',
				body: str,
				mode: 'same-origin',
				headers: headers
			});
		console.log(str);
	}

	constructor(private readonly _editor: ICodeEditor) {}

	public dispose() {
		this.log('log.end');
	}

	public synthStart(problem: any, examples: number, lineno: number) {
		this.log(`synth.start.${this.synthRequestCounter}.${lineno}.${examples}`);

		console.log(JSON.stringify(problem, null, 2));
		console.log(this._editor.getModel()?.getLinesContent().join('\n'));

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

	public projectionBoxFocus(line: string, custom?: boolean) {
		if (custom) {
			this.log('focus.projectionBox.focus.custom', line);
		} else {
			this.log('focus.projectionBox.focus.default', line);
		}
	}

	public projectionBoxUpdateStart(): void {
		this.log('projectionBox.update.start');
	}

	public projectionBoxUpdateEnd(): void {
		this.log('projectionBox.update.end');
	}

	public projectionBoxExit() {
		this.log('focus.projectionBox.exit');
	}

	public exampleBlur(idx: number, content: string) {
		this.log(`focus.example.${idx}.blur`, content);
	}

	public exampleFocus(idx: number, content: string) {
		this.log(`focus.example.${idx}.focus`, content);
	}

	public exampleChanged(idx: number, was: string, is: string) {
		this.log(`example.${idx}.change`, `${was},${is}`);
	}

	public exampleInclude(idx: number, content: string) {
		this.log(`example.${idx}.include`, content);
	}

	public exampleExclude(idx: number, content: string) {
		this.log(`example.${idx}.exclude`, content);
	}

	public exampleReset() {
		this.log('example.all.reset');
	}
}
