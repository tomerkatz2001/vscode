import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IRTVLogger } from '../../../../workbench/contrib/rtv/common/IRTVLogger.js';
import { SynthProblem, SynthResult } from '../RTVInterfaces.js';

export class RTVFRontendLogger implements IRTVLogger {
	_serviceBrand: undefined;
	protected readonly channel: IChannel;

	constructor(
		// Inject the main process service to send messages
		@IMainProcessService private readonly mainProcessService: IMainProcessService
	) {
		this.channel = this.mainProcessService.getChannel('rtvLogger');
	}
	projectionBoxCreated(): void {
		this.channel.call('projectionBoxCreated');
	}
	projectionBoxDestroyed(): void {
		this.channel.call('projectionBoxDestroyed');
	}
	projectionBoxUpdateStart(program: string): void {
		this.channel.call('projectionBoxUpdateStart', program);
	}
	projectionBoxUpdateEnd(result: string | undefined): void {
		this.channel.call('projectionBoxUpdateEnd', result);
	}
	projectionBoxModeChanged(mode: string): void {
		this.channel.call('projectionBoxModeChanged', mode);
	}
	imgSummaryStart(lineno: number, variable: string): void {
		this.channel.call('imgSummaryStart', [lineno, variable]);
	}
	imgSummaryEnd(result?: string | undefined): void {
		this.channel.call('imgSummaryEnd', result);
	}
	showOutputBox(): void {
		this.channel.call('showOutputBox');
	}
	hideOutputBox(): void {
		this.channel.call('hideOutputBox');
	}
	synthProcessStart(): void {
		this.channel.call('synthProcessStart');
	}
	synthStart(varnames: string[], lineno: number): void {
		this.channel.call('synthStart', [varnames, lineno]);
	}
	synthEnd(): void {
		this.channel.call('synthEnd');
	}
	synthSubmit(problem: SynthProblem): void {
		this.channel.call('synthSubmit', problem);
	}
	synthResult(result: SynthResult): void {
		this.channel.call('synthResult', result);
	}
	synthStdout(msg: string): void {
		this.channel.call('synthStdout', msg);
	}

	synthStderr(msg: string): void {
		this.channel.call('synthStderr', msg);
	}
	synthProcessEnd(): void {
		this.channel.call('synthProcessEnd');
	}
	insertComments(lineno: number, comments: string): void {
		this.channel.call('insertComments', [lineno, comments]);
	}
	newTestResults(testResults: string): void {
		this.channel.call('newTestResults', testResults);
	}
	resynthesisAsked(lineno: number): void {
		this.channel.call('resynthesisAsked', lineno);
	}

}
