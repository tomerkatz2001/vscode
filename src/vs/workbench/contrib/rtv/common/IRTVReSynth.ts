import { SynthResult } from '../../../../editor/contrib/rtv/RTVInterfaces.js';
import { RTVSpecification } from '../../../../editor/contrib/rtv/RTVSpecification.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IRTVReSynth {
	readonly _serviceBrand: undefined;
	reSynthesize(problem: RTVSpecification): Promise<SynthResult | undefined>;
	stop(): boolean;
	connected(): boolean;
}

export const IRTVReSynthService = createDecorator<IRTVReSynth>('RTVReSynthSercive');
