import { RTVFrontendUtils } from '../../../../editor/contrib/rtv/fronted/RTVFrontendUtils.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IRTVNodeUtilsService } from '../common/IRTVNodeUtils.js';

registerSingleton(IRTVNodeUtilsService, RTVFrontendUtils, InstantiationType.Eager);
console.log('RTVFrontendUtils registered as IRTVNodeUtilsService');
