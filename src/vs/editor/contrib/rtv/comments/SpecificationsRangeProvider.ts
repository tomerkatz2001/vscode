// eslint-disable-next-line code-import-patterns
import {
	FoldingRange,
	FoldingRangeKind,
	FoldingRangeProvider,
	FoldingContext,
	CancellationToken,
	ProviderResult,
	TextDocument,
} from 'vscode';
import { SYNTHESIZED_COMMENT_START } from './RTVCommentsConsts.js';



export class SpecificationsRangeProvider implements FoldingRangeProvider {
	provideFoldingRanges(
		document: TextDocument,
		context: FoldingContext,
		token: CancellationToken
	): ProviderResult<FoldingRange[]> {
		return this.computeRanges(document);
	}

	private computeRanges(document: TextDocument): FoldingRange[] {
		const startLines: number[] = [];
		const endLines: number[] = [];
		let inRegion = false;

		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i).text;

			if (line.includes(SYNTHESIZED_COMMENT_START) && !inRegion) {
				startLines.push(i);
				inRegion = true;
			} else if (line.includes(SYNTHESIZED_COMMENT_START) && inRegion) {
				endLines.push(i - 1);
				startLines.push(i);
				inRegion = true;
			} else if (!line.includes('#!') && inRegion) {
				endLines.push(i - 1);
				inRegion = false;
			}
		}

		const ranges: FoldingRange[] = [];
		for (let k = 0; k < startLines.length; k++) {
			ranges.push(
				new FoldingRange(startLines[k], endLines[k], FoldingRangeKind.Comment)
			);
		}

		return ranges;
	}
}
