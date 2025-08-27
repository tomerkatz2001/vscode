import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IRTVValidate {
	readonly _serviceBrand: undefined;

	validate(input: string): Promise<string | undefined>
}

export const IRTVValidateService = createDecorator<IRTVValidate>('RTVValidateService');
