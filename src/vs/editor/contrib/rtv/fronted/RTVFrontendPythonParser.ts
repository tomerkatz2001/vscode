import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IPythonParserService } from '../../../../workbench/contrib/rtv/common/Ipython_parse.js';

export class RTVFrontendPythonParser implements IPythonParserService {
	_serviceBrand: undefined;
	protected readonly channel: IChannel;

	constructor(
		// Inject the main process service to send messages
		@IMainProcessService private readonly mainProcessService: IMainProcessService
	) {
		this.channel = this.mainProcessService.getChannel('rtvPythonParser');
	}
	findVariableNames(code: string): Promise<string[]> {
		return this.channel.call('findVariableNames', code)
	}

}
