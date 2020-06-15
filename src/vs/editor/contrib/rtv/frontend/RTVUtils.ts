import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import {RTVLogger} from "vs/editor/contrib/rtv/RTVLogger";

// TODO This is assuming Linux. Can we get this from the server to be safe?
export const EOL: string = '\n';

export function getLogger(_: ICodeEditor): RTVLogger {
	return new class implements RTVLogger {
		dispose(): void {
		}

		exampleBlur(idx: number, content: string): void {
		}

		exampleChanged(idx: number, was: string, is: string): void {
		}

		exampleExclude(idx: number, content: string): void {
		}

		exampleFocus(idx: number, content: string): void {
		}

		exampleInclude(idx: number, content: string): void {
		}

		exampleReset(): void {
		}

		projectionBoxExit(): void {
		}

		projectionBoxFocus(line: string, custom?: boolean): void {
		}

		synthEnd(exitCode: number, result?: string): void {
		}

		synthErr(msg: string): void {
		}

		synthOut(msg: string): void {
		}

		synthStart(problem: any, examples: number, lineno: number): void {
		}
	}
}