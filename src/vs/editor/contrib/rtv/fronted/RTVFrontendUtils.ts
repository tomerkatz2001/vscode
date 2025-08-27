import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IRTVNodeUtils } from '../../../../workbench/contrib/rtv/common/IRTVNodeUtils.js';
import { ParsedComment } from '../comments/RTVComment.js';
import { RunResult, SynthProcess, ReSynthProcess } from '../RTVInterfaces.js';

export class RTVFrontendUtils implements IRTVNodeUtils {
	protected readonly channel: IChannel;

	constructor(
		// Inject the main process service to send messages
		@IMainProcessService private readonly mainProcessService: IMainProcessService
	) {
		this.channel = this.mainProcessService.getChannel('rtvNodeUtils');
	}

	isLoopy(): Promise<boolean> {
		return this.channel.call('isLoopy');
	}
	parseComment(code: string): Promise<ParsedComment> {
		return this.channel.call('parseComment', code);
	}
	runProgram(program: string, cwd?: string | undefined, values?: any): Promise<RunResult> {
		return this.channel.call('runProgram', [program, cwd, values]);
	}
	getEOL(): Promise<string> {
		return this.channel.call('getEOL');
	}
	synthesizer(): Promise<SynthProcess> {
		return this.channel.call('synthesizer');
	}
	resynthesizer(): Promise<ReSynthProcess> {
		return this.channel.call('resynthesizer');
	}
	validate(input: string): Promise<string | undefined> {
		return this.channel.call('validate', input);
	}
	readonly _serviceBrand: undefined;

}


