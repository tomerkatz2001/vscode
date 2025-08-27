import { SynthProblem, SynthResult } from '../../../../editor/contrib/rtv/RTVInterfaces.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IRTVSynth {
	readonly _serviceBrand: undefined;
	synthesize(problem: SynthProblem): Promise<SynthResult | undefined>;
	stop(): boolean;
	connected(): boolean;
}

export const IRTVSynthService = createDecorator<IRTVSynth>('RTVSynthSercive');
