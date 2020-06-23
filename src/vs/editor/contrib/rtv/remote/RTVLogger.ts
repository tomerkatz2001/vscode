import { IRTVLogger } from 'vs/editor/contrib/rtv/RTVInterfaces';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

export class RTVLogger implements IRTVLogger {
	// TODO Actually use the editor, so we can remove the following:
	// @ts-ignore
	constructor(private readonly _editor: ICodeEditor) {}

	dispose(): void {
		// TODO
	}

	synthStart(problem: any, examples: number, lineno: number): void {
		// TODO
	}

	synthOut(msg: string): void {
		// TODO
	}

	synthErr(msg: string): void {
		// TODO
	}

	synthEnd(exitCode: number, result?: string): void {
		// TODO
	}

	projectionBoxFocus(line: string, custom?: boolean): void {
		// TODO
	}

	projectionBoxExit(): void {
		// TODO
	}

	exampleBlur(idx: number, content: string): void {
		// TODO
	}

	exampleFocus(idx: number, content: string): void {
		// TODO
	}

	exampleChanged(idx: number, was: string, is: string): void {
		// TODO
	}

	exampleInclude(idx: number, content: string): void {
		// TODO
	}

	exampleExclude(idx: number, content: string): void {
		// TODO
	}

	exampleReset(): void {
		// TODO
	}
}
