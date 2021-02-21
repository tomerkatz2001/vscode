import { ARTVLogger } from 'vs/editor/contrib/rtv/RTVInterfaces';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

// class LogRequestData {
// 	constructor(
// 		public event: string,
// 		public program ?: string,
// 		public result ?: string) {}
// }

export class RTVLogger extends ARTVLogger {
	private logCounter: number;

	constructor(editor: ICodeEditor) {
		super(editor);
		this.logCounter = 0;
	}

	protected log(code: string, msg?: string): number {
		this.logCounter++;
		// TODO
		return this.logCounter;
	}

	protected write(file: string, content: any): void {
		// TODO
	}
}
