import { ARTVLogger } from 'vs/editor/contrib/rtv/RTVInterfaces';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

class LogEventData {
	constructor(
		public code: string,
		public message?: string,
		) {}
}

class LogResultData {
	constructor(
		public file: string,
		public content: string) {}
}

function headers(contentType: string = 'application/json;charset=UTF-8'): Headers {
	const headers = new Headers();
	headers.append('Content-Type', contentType);

	// We need this for CSRF protection on the server
	const csrfInput = document.getElementById('csrf-parameter') as HTMLInputElement;
	const csrfToken = csrfInput.value;
	const csrfHeaderName = csrfInput.name;
	if (csrfHeaderName) {
		headers.append(csrfHeaderName, csrfToken);
	}

	return headers;
}


export class RTVLogger extends ARTVLogger {
	private logCounter: number;

	constructor(editor: ICodeEditor) {
		super(editor);
		this.logCounter = 0;
	}

	private now(): number {
		return new Date().getTime();
	}

	protected log(code: string, msg?: string): number {
		// Always do this first!
		this.logCounter++;

		// Send to server
		const body = new LogEventData(code, msg);
		fetch(
			'/logEvent',
			{
				method: 'POST',
				body: JSON.stringify(body),
				mode: 'same-origin',
				headers: headers()
			});

		// Also log it to console
		let log: string;
		if (msg) {
			msg = msg.replace(/\n/g, '\\n');
			log = `${this.now()},${code},${msg}`;
		} else {
			log = `${this.now()},${code}`;
		}
		console.log(log);

		return this.logCounter;
	}

	protected write(file: string, content: any): void {
		let contentStr;

		if (content instanceof String || typeof content === 'string') {
			contentStr = content.toString();
		} else {
			contentStr = JSON.stringify(content);
		}

		const body = new LogResultData(file, contentStr);

		fetch(
			'/logEvent',
			{
				method: 'POST',
				body: JSON.stringify(body),
				mode: 'same-origin',
				headers: headers()
			});
	}
}
