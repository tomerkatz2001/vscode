import { RunResult } from '../../../../editor/contrib/rtv/RTVInterfaces.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IRTVRunProcess extends PromiseLike<RunResult> {
	readonly _serviceBrand: undefined;

	kill(): boolean;
	runProgram(program: string, cwd?: string, values?: any): Promise<RunResult>

}


export const IRTVRunProcessService = createDecorator<IRTVRunProcess>('RTVRunProcess');
