import { SynthProblem, SynthResult } from '../../../../editor/contrib/rtv/RTVInterfaces.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * The Logging interface for RTVDisplay.
 */
export interface IRTVLogger {
	readonly _serviceBrand: undefined;

	// General Projection Boxes
	projectionBoxCreated(): void;
	projectionBoxDestroyed(): void;
	projectionBoxUpdateStart(program: string): void;
	projectionBoxUpdateEnd(result: string | undefined): void;
	projectionBoxModeChanged(mode: string): void;

	// Image Processing
	imgSummaryStart(lineno: number, variable: string): void;
	imgSummaryEnd(result?: string): void;

	// Output Box
	showOutputBox(): void;
	hideOutputBox(): void;

	// LooPy
	synthProcessStart(): void;
	synthStart(varnames: string[], lineno: number): void;
	synthEnd(): void;
	synthSubmit(problem: SynthProblem): void;
	synthResult(result: SynthResult): void;
	synthStdout(msg: string): void;
	synthStderr(msg: string): void;
	synthProcessEnd(): void;

	// Comments
	insertComments(lineno: number, comments: string): void;
	newTestResults(testResults: string): void;


	//resynthesis
	resynthesisAsked(lineno: number): void;
}

export abstract class ARTVLogger implements IRTVLogger {
	readonly _serviceBrand: undefined;

	constructor() { }
	protected abstract log(code: string, msg?: string): number;
	protected abstract write(file: string, content: string): void;

	// ---------------------------------------------------------------
	// General Projection Boxes
	// ---------------------------------------------------------------

	public projectionBoxCreated() {
		this.log('projectionBox.created');
	}

	public projectionBoxDestroyed() {
		this.log('projectionBox.destroyed');
	}

	public projectionBoxUpdateStart(program: string): void {
		const id = this.log('projectionBox.update.start');
		this.write(`${id}_program.py`, program);
	}

	public projectionBoxUpdateEnd(result: string | undefined): void {
		const id = this.log('projectionBox.update.end');
		this.write(`${id}_result.json`, result ? result : 'undefined');
	}

	public projectionBoxModeChanged(mode: string): void {
		this.log(`projectionBox.mode.${mode}`);
	}

	// ---------------------------------------------------------------
	// Image Processing
	// ---------------------------------------------------------------

	public imgSummaryStart(lineno: number, variable: string) {
		this.log('img.start', `${lineno},${variable}`);
	}

	public imgSummaryEnd() {
		this.log('img.end');
	}

	// ---------------------------------------------------------------
	// Output Box
	// ---------------------------------------------------------------

	public showOutputBox(): void {
		this.log(`outputBox.show`);
	}

	public hideOutputBox(): void {
		this.log(`outputBox.hide`);
	}

	// ---------------------------------------------------------------
	// Synthesis
	// ---------------------------------------------------------------

	synthProcessStart(): void {
		this.log('synth.process.start');
	}

	synthStart(varnames: string[], lineno: number): void {
		this.log('synth.start', `${varnames},${lineno}`);
	}

	synthEnd(): void {
		this.log('synth.end');
	}

	synthSubmit(problem: SynthProblem): void {
		const id = this.log('synth.submit');
		this.write(`${id}_problem.json`, JSON.stringify(problem, undefined, '\t'));
	}

	synthResult(result: SynthResult): void {
		const id = this.log('synth.result');
		this.write(`${id}_result.json`, JSON.stringify(result, undefined, '\t'));
	}

	synthStdout(msg: string): void {
		this.log('synth.stdout', msg.toString());
	}

	synthStderr(msg: string): void {
		this.log('synth.stderr', msg.toString());
	}

	synthProcessEnd(): void {
		this.log('synth.process.end');
	}

	//----------------------------------------------------------------------
	// Comments
	//----------------------------------------------------------------------
	insertComments(lineno: number, comments: string) {
		this.log('comments.insert', `${lineno},${comments}`);
	}

	newTestResults(testResults: string) {
		this.log('comments.testResults', testResults);
	}

	//----------------------------------------------------------------------
	// Resynthesis
	//----------------------------------------------------------------------
	resynthesisAsked(lineno: number) {
		this.log('resynthesis.asked', lineno.toString());
	}
}

export const IRTVLoggerService = createDecorator<IRTVLogger>('RTVLoggerService');
