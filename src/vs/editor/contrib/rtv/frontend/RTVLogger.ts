export interface RTVLogger {
	dispose(): void;
	synthStart(problem: any, examples: number, lineno: number): void;
	synthOut(msg: string): void;
	synthErr(msg: string): void;
	synthEnd(exitCode: number, result?: string): void;
	projectionBoxFocus(line: string, custom?: boolean): void;
	projectionBoxExit(): void;
	exampleBlur(idx: number, content: string): void;
	exampleFocus(idx: number, content: string): void;
	exampleChanged(idx: number, was: string, is: string): void;
	exampleInclude(idx: number, content: string): void;
	exampleExclude(idx: number, content: string): void;
	exampleReset(): void;
}