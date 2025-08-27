import { ReSynthProcess, RunResult, SynthProcess } from '../../../../editor/contrib/rtv/RTVInterfaces.js';
import { ParsedComment } from '../../../../editor/contrib/rtv/comments/RTVComment.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IRTVNodeUtils {
	readonly _serviceBrand: undefined;
	isLoopy(): Promise<boolean>
	parseComment(code: string): Promise<ParsedComment>;
	runProgram(program: string, cwd?: string, values?: any): Promise<RunResult>;
	getEOL(): Promise<string>;
	synthesizer(): Promise<SynthProcess>;
	resynthesizer(): Promise<ReSynthProcess>;
	validate(input: string): Promise<string | undefined>;
}

export interface ParseProcess extends PromiseLike<ParsedComment> {
	kill(): boolean;
}

export const IRTVNodeUtilsService = createDecorator<IRTVNodeUtils>('RTVNodeUtilsService!!!!');
