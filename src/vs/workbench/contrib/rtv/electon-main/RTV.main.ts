import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Server as NodeIPCServer } from '../../../../base/parts/ipc/node/ipc.net.js';
import { IRTVNodeUtilsService } from '../common/IRTVNodeUtils.js';
import { RTVNodeUtils } from '../node/RTVNodeUtils.js';

// 1. Register the backend service
registerSingleton(IRTVNodeUtilsService, RTVNodeUtils, InstantiationType.Eager);

// 2. Register the IPC handlers. This code runs in the main process.
export function registerRTVServices(instantiationService: IInstantiationService, ipcMainService: NodeIPCServer): void {
	// Get the instance of your backend service from the DI container
	const rtvNodeUtilsService = instantiationService.invokeFunction(accessor => accessor.get(IRTVNodeUtilsService));

	const store = new DisposableStore();

	const serviceChannel = ProxyChannel.fromService(rtvNodeUtilsService, store);

	ipcMainService.registerChannel('rtvNodeUtils', serviceChannel);

}
