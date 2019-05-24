/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Color, RGBA } from 'vs/base/common/color';
import { IMarkdownString, MarkdownString, isEmptyMarkdownString, markedStringsEquals } from 'vs/base/common/htmlContent';
import { IDisposable, toDisposable, DisposableStore, combinedDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { DocumentColorProvider, Hover as MarkdownHover, HoverProviderRegistry, IColor, TokenizationRegistry, CodeActionTriggerType } from 'vs/editor/common/modes';
import { getColorPresentations } from 'vs/editor/contrib/colorPicker/color';
import { ColorDetector } from 'vs/editor/contrib/colorPicker/colorDetector';
import { ColorPickerModel } from 'vs/editor/contrib/colorPicker/colorPickerModel';
import { ColorPickerWidget } from 'vs/editor/contrib/colorPicker/colorPickerWidget';
import { getHover } from 'vs/editor/contrib/hover/getHover';
import { HoverOperation, HoverStartMode, IHoverComputer } from 'vs/editor/contrib/hover/hoverOperation';
import { ContentHoverWidget } from 'vs/editor/contrib/hover/hoverWidgets';
import { MarkdownRenderer } from 'vs/editor/contrib/markdown/markdownRenderer';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { coalesce, isNonEmptyArray, asArray } from 'vs/base/common/arrays';
import { IMarker, IMarkerData, MarkerSeverity } from 'vs/platform/markers/common/markers';
import { basename } from 'vs/base/common/resources';
import { IMarkerDecorationsService } from 'vs/editor/common/services/markersDecorationService';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IOpenerService, NullOpenerService } from 'vs/platform/opener/common/opener';
import { MarkerController, NextMarkerAction } from 'vs/editor/contrib/gotoError/gotoError';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { CancelablePromise, createCancelablePromise } from 'vs/base/common/async';
import { getCodeActions, CodeActionSet } from 'vs/editor/contrib/codeAction/codeAction';
import { QuickFixAction, QuickFixController } from 'vs/editor/contrib/codeAction/codeActionCommands';
import { CodeActionKind, CodeActionTrigger } from 'vs/editor/contrib/codeAction/types';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IIdentifiedSingleEditOperation } from 'vs/editor/common/model';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { Constants } from 'vs/base/common/uint';

const $ = dom.$;

class ColorHover {

	constructor(
		public readonly range: IRange,
		public readonly color: IColor,
		public readonly provider: DocumentColorProvider
	) { }
}

class MarkerHover {

	constructor(
		public readonly range: IRange,
		public readonly marker: IMarker,
	) { }
}

type HoverPart = MarkdownHover | ColorHover | MarkerHover;

class ModesContentComputer implements IHoverComputer<HoverPart[]> {

	private readonly _editor: ICodeEditor;
	private _result: HoverPart[];
	private _range?: Range;

	constructor(
		editor: ICodeEditor,
		private readonly _markerDecorationsService: IMarkerDecorationsService
	) {
		this._editor = editor;
		this._result = [];
	}

	setRange(range: Range): void {
		this._range = range;
		this._result = [];
	}

	clearResult(): void {
		this._result = [];
	}

	computeAsync(token: CancellationToken): Promise<HoverPart[]> {
		if (!this._editor.hasModel() || !this._range) {
			return Promise.resolve([]);
		}

		const model = this._editor.getModel();

		if (!HoverProviderRegistry.has(model)) {
			return Promise.resolve([]);
		}

		return getHover(model, new Position(
			this._range.startLineNumber,
			this._range.startColumn
		), token);
	}

	computeSync(): HoverPart[] {
		if (!this._editor.hasModel() || !this._range) {
			return [];
		}

		const model = this._editor.getModel();
		const lineNumber = this._range.startLineNumber;

		if (lineNumber > this._editor.getModel().getLineCount()) {
			// Illegal line number => no results
			return [];
		}

		const colorDetector = ColorDetector.get(this._editor);
		const maxColumn = model.getLineMaxColumn(lineNumber);
		const lineDecorations = this._editor.getLineDecorations(lineNumber);
		let didFindColor = false;

		const hoverRange = this._range;
		const result = lineDecorations.map((d): HoverPart | null => {
			const startColumn = (d.range.startLineNumber === lineNumber) ? d.range.startColumn : 1;
			const endColumn = (d.range.endLineNumber === lineNumber) ? d.range.endColumn : maxColumn;

			if (startColumn > hoverRange.startColumn || hoverRange.endColumn > endColumn) {
				return null;
			}

			const range = new Range(hoverRange.startLineNumber, startColumn, hoverRange.startLineNumber, endColumn);
			const marker = this._markerDecorationsService.getMarker(model, d);
			if (marker) {
				return new MarkerHover(range, marker);
			}

			const colorData = colorDetector.getColorData(d.range.getStartPosition());

			if (!didFindColor && colorData) {
				didFindColor = true;

				const { color, range } = colorData.colorInfo;
				return new ColorHover(range, color, colorData.provider);
			} else {
				if (isEmptyMarkdownString(d.options.hoverMessage)) {
					return null;
				}

				const contents: IMarkdownString[] = d.options.hoverMessage ? asArray(d.options.hoverMessage) : [];
				return { contents, range };
			}
		});

		return coalesce(result);
	}

	onResult(result: HoverPart[], isFromSynchronousComputation: boolean): void {
		// Always put synchronous messages before asynchronous ones
		if (isFromSynchronousComputation) {
			this._result = result.concat(this._result.sort((a, b) => {
				if (a instanceof ColorHover) { // sort picker messages at to the top
					return -1;
				} else if (b instanceof ColorHover) {
					return 1;
				}
				return 0;
			}));
		} else {
			this._result = this._result.concat(result);
		}
	}

	getResult(): HoverPart[] {
		return this._result.slice(0);
	}

	getResultWithLoadingMessage(): HoverPart[] {
		return this._result.slice(0).concat([this._getLoadingMessage()]);
	}

	private _getLoadingMessage(): HoverPart {
		return {
			range: this._range,
			contents: [new MarkdownString().appendText(nls.localize('modesContentHover.loading', "Loading..."))]
		};
	}
}

const markerCodeActionTrigger: CodeActionTrigger = {
	type: CodeActionTriggerType.Manual,
	filter: { include: CodeActionKind.QuickFix }
};

export class ModesContentHoverWidget extends ContentHoverWidget {

	static readonly ID = 'editor.contrib.modesContentHoverWidget';

	private _messages: HoverPart[];
	private _lastRange: Range | null;
	private readonly _computer: ModesContentComputer;
	private readonly _hoverOperation: HoverOperation<HoverPart[]>;
	private _highlightDecorations: string[];
	private _isChangingDecorations: boolean;
	private _shouldFocus: boolean;
	private _colorPicker: ColorPickerWidget | null;

	private readonly renderDisposable = this._register(new MutableDisposable<IDisposable>());

	constructor(
		editor: ICodeEditor,
		markerDecorationsService: IMarkerDecorationsService,
		private readonly _themeService: IThemeService,
		private readonly _keybindingService: IKeybindingService,
		private readonly _modeService: IModeService,
		private readonly _openerService: IOpenerService = NullOpenerService,
	) {
		super(ModesContentHoverWidget.ID, editor);

		this._messages = [];
		this._lastRange = null;
		this._computer = new ModesContentComputer(this._editor, markerDecorationsService);
		this._highlightDecorations = [];
		this._isChangingDecorations = false;
		this._shouldFocus = false;
		this._colorPicker = null;

		this._hoverOperation = new HoverOperation(
			this._computer,
			result => this._withResult(result, true),
			null,
			result => this._withResult(result, false),
			this._editor.getOption(EditorOption.hover).delay
		);

		this._register(dom.addStandardDisposableListener(this.getDomNode(), dom.EventType.FOCUS, () => {
			if (this._colorPicker) {
				dom.addClass(this.getDomNode(), 'colorpicker-hover');
			}
		}));
		this._register(dom.addStandardDisposableListener(this.getDomNode(), dom.EventType.BLUR, () => {
			dom.removeClass(this.getDomNode(), 'colorpicker-hover');
		}));
		this._register(editor.onDidChangeConfiguration((e) => {
			this._hoverOperation.setHoverTime(this._editor.getOption(EditorOption.hover).delay);
		}));
		this._register(TokenizationRegistry.onDidChange((e) => {
			if (this.isVisible && this._lastRange && this._messages.length > 0) {
				this._domNode.textContent = '';
				this._renderMessages(this._lastRange, this._messages);
			}
		}));
	}

	dispose(): void {
		this._hoverOperation.cancel();
		super.dispose();
	}

	onModelDecorationsChanged(): void {
		if (this._isChangingDecorations) {
			return;
		}
		if (this.isVisible) {
			// The decorations have changed and the hover is visible,
			// we need to recompute the displayed text
			this._hoverOperation.cancel();
			this._computer.clearResult();

			if (!this._colorPicker) { // TODO@Michel ensure that displayed text for other decorations is computed even if color picker is in place
				this._hoverOperation.start(HoverStartMode.Delayed);
			}
		}
	}

	startShowingAt(range: Range, mode: HoverStartMode, focus: boolean): void {
		if (this._lastRange && this._lastRange.equalsRange(range)) {
			// We have to show the widget at the exact same range as before, so no work is needed
			return;
		}

		this._hoverOperation.cancel();

		if (this.isVisible) {
			// The range might have changed, but the hover is visible
			// Instead of hiding it completely, filter out messages that are still in the new range and
			// kick off a new computation
			if (!this._showAtPosition || this._showAtPosition.lineNumber !== range.startLineNumber) {
				this.hide();
			} else {
				let filteredMessages: HoverPart[] = [];
				for (let i = 0, len = this._messages.length; i < len; i++) {
					const msg = this._messages[i];
					const rng = msg.range;
					if (rng && rng.startColumn <= range.startColumn && rng.endColumn >= range.endColumn) {
						filteredMessages.push(msg);
					}
				}
				if (filteredMessages.length > 0) {
					if (hoverContentsEquals(filteredMessages, this._messages)) {
						return;
					}
					this._renderMessages(range, filteredMessages);
				} else {
					this.hide();
				}
			}
		}

		this._lastRange = range;
		this._computer.setRange(range);
		this._shouldFocus = focus;
		this._hoverOperation.start(mode);
	}

	hide(): void {
		this._lastRange = null;
		this._hoverOperation.cancel();
		super.hide();
		this._isChangingDecorations = true;
		this._highlightDecorations = this._editor.deltaDecorations(this._highlightDecorations, []);
		this._isChangingDecorations = false;
		this.renderDisposable.clear();
		this._colorPicker = null;
	}

	isColorPickerVisible(): boolean {
		if (this._colorPicker) {
			return true;
		}
		return false;
	}

	private _withResult(result: HoverPart[], complete: boolean): void {
		this._messages = result;

		if (this._lastRange && this._messages.length > 0) {
			this._renderMessages(this._lastRange, this._messages);
		} else if (complete) {
			this.hide();
		}
	}

	private _renderMessages(renderRange: Range, messages: HoverPart[]): void {
		this.renderDisposable.dispose();
		this._colorPicker = null;

		// update column from which to show
		let renderColumn = Constants.MAX_SAFE_SMALL_INTEGER;
		let highlightRange: Range | null = messages[0].range ? Range.lift(messages[0].range) : null;
		let fragment = document.createDocumentFragment();
		let isEmptyHoverContent = true;

		let containColorPicker = false;
		const markdownDisposeables = new DisposableStore();
		const markerMessages: MarkerHover[] = [];
		messages.forEach((msg) => {
			if (!msg.range) {
				return;
			}

			renderColumn = Math.min(renderColumn, msg.range.startColumn);
			highlightRange = highlightRange ? Range.plusRange(highlightRange, msg.range) : Range.lift(msg.range);

			if (msg instanceof ColorHover) {
				containColorPicker = true;

				const { red, green, blue, alpha } = msg.color;
				const rgba = new RGBA(Math.round(red * 255), Math.round(green * 255), Math.round(blue * 255), alpha);
				const color = new Color(rgba);

				if (!this._editor.hasModel()) {
					return;
				}

				const editorModel = this._editor.getModel();
				let range = new Range(msg.range.startLineNumber, msg.range.startColumn, msg.range.endLineNumber, msg.range.endColumn);
				let colorInfo = { range: msg.range, color: msg.color };

				// create blank olor picker model and widget first to ensure it's positioned correctly.
				const model = new ColorPickerModel(color, [], 0);
				const widget = new ColorPickerWidget(fragment, model, this._editor.getOption(EditorOption.pixelRatio), this._themeService);

				getColorPresentations(editorModel, colorInfo, msg.provider, CancellationToken.None).then(colorPresentations => {
					model.colorPresentations = colorPresentations || [];
					if (!this._editor.hasModel()) {
						// gone...
						return;
					}
					const originalText = this._editor.getModel().getValueInRange(msg.range);
					model.guessColorPresentation(color, originalText);

					const updateEditorModel = () => {
						let textEdits: IIdentifiedSingleEditOperation[];
						let newRange: Range;
						if (model.presentation.textEdit) {
							textEdits = [model.presentation.textEdit as IIdentifiedSingleEditOperation];
							newRange = new Range(
								model.presentation.textEdit.range.startLineNumber,
								model.presentation.textEdit.range.startColumn,
								model.presentation.textEdit.range.endLineNumber,
								model.presentation.textEdit.range.endColumn
							);
							newRange = newRange.setEndPosition(newRange.endLineNumber, newRange.startColumn + model.presentation.textEdit.text.length);
						} else {
							textEdits = [{ identifier: null, range, text: model.presentation.label, forceMoveMarkers: false }];
							newRange = range.setEndPosition(range.endLineNumber, range.startColumn + model.presentation.label.length);
						}

						this._editor.pushUndoStop();
						this._editor.executeEdits('colorpicker', textEdits);

						if (model.presentation.additionalTextEdits) {
							textEdits = [...model.presentation.additionalTextEdits as IIdentifiedSingleEditOperation[]];
							this._editor.executeEdits('colorpicker', textEdits);
							this.hide();
						}
						this._editor.pushUndoStop();
						range = newRange;
					};

					const updateColorPresentations = (color: Color) => {
						return getColorPresentations(editorModel, {
							range: range,
							color: {
								red: color.rgba.r / 255,
								green: color.rgba.g / 255,
								blue: color.rgba.b / 255,
								alpha: color.rgba.a
							}
						}, msg.provider, CancellationToken.None).then((colorPresentations) => {
							model.colorPresentations = colorPresentations || [];
						});
					};

					const colorListener = model.onColorFlushed((color: Color) => {
						updateColorPresentations(color).then(updateEditorModel);
					});
					const colorChangeListener = model.onDidChangeColor(updateColorPresentations);

					this._colorPicker = widget;
					this.showAt(range.getStartPosition(), range, this._shouldFocus);
					this.updateContents(fragment);
					this._colorPicker.layout();

					this.renderDisposable.value = combinedDisposable(colorListener, colorChangeListener, widget, markdownDisposeables);
				});
			} else {
				if (msg instanceof MarkerHover) {
					markerMessages.push(msg);
					isEmptyHoverContent = false;
				} else {
					msg.contents
						.filter(contents => !isEmptyMarkdownString(contents))
						.forEach(contents => {
							const markdownHoverElement = $('div.hover-row.markdown-hover');
							const hoverContentsElement = dom.append(markdownHoverElement, $('div.hover-contents'));
							const renderer = markdownDisposeables.add(new MarkdownRenderer(this._editor, this._modeService, this._openerService));
							markdownDisposeables.add(renderer.onDidRenderCodeBlock(() => {
								hoverContentsElement.className = 'hover-contents code-hover-contents';
								this.onContentsChange();
							}));
							const renderedContents = markdownDisposeables.add(renderer.render(contents));
							hoverContentsElement.appendChild(renderedContents.element);
							fragment.appendChild(markdownHoverElement);
							isEmptyHoverContent = false;
						});
				}
			}
		});

		if (markerMessages.length) {
			markerMessages.forEach(msg => fragment.appendChild(this.renderMarkerHover(msg)));
			const markerHoverForStatusbar = markerMessages.length === 1 ? markerMessages[0] : markerMessages.sort((a, b) => MarkerSeverity.compare(a.marker.severity, b.marker.severity))[0];
			fragment.appendChild(this.renderMarkerStatusbar(markerHoverForStatusbar));
		}

		// show

		if (!containColorPicker && !isEmptyHoverContent) {
			this.showAt(new Position(renderRange.startLineNumber, renderColumn), highlightRange, this._shouldFocus);
			this.updateContents(fragment);
		}

		this._isChangingDecorations = true;
		this._highlightDecorations = this._editor.deltaDecorations(this._highlightDecorations, highlightRange ? [{
			range: highlightRange,
			options: ModesContentHoverWidget._DECORATION_OPTIONS
		}] : []);
		this._isChangingDecorations = false;
	}

	private renderMarkerHover(markerHover: MarkerHover): HTMLElement {
		const hoverElement = $('div.hover-row');
		const markerElement = dom.append(hoverElement, $('div.marker.hover-contents'));
		const { source, message, code, relatedInformation } = markerHover.marker;

		this._editor.applyFontInfo(markerElement);
		const messageElement = dom.append(markerElement, $('span'));
		messageElement.style.whiteSpace = 'pre-wrap';
		messageElement.innerText = message;

		if (source || code) {
			const detailsElement = dom.append(markerElement, $('span'));
			detailsElement.style.opacity = '0.6';
			detailsElement.style.paddingLeft = '6px';
			detailsElement.innerText = source && code ? `${source}(${code})` : source ? source : `(${code})`;
		}

		if (isNonEmptyArray(relatedInformation)) {
			for (const { message, resource, startLineNumber, startColumn } of relatedInformation) {
				const relatedInfoContainer = dom.append(markerElement, $('div'));
				relatedInfoContainer.style.marginTop = '8px';
				const a = dom.append(relatedInfoContainer, $('a'));
				a.innerText = `${basename(resource)}(${startLineNumber}, ${startColumn}): `;
				a.style.cursor = 'pointer';
				a.onclick = e => {
					e.stopPropagation();
					e.preventDefault();
					if (this._openerService) {
						this._openerService.open(resource.with({ fragment: `${startLineNumber},${startColumn}` }), { fromUserGesture: true }).catch(onUnexpectedError);
					}
				};
				const messageElement = dom.append<HTMLAnchorElement>(relatedInfoContainer, $('span'));
				messageElement.innerText = message;
				this._editor.applyFontInfo(messageElement);
			}
		}

		return hoverElement;
	}

	private renderMarkerStatusbar(markerHover: MarkerHover): HTMLElement {
		const hoverElement = $('div.hover-row.status-bar');
		const disposables = new DisposableStore();
		const actionsElement = dom.append(hoverElement, $('div.actions'));
		if (markerHover.marker.severity === MarkerSeverity.Error || markerHover.marker.severity === MarkerSeverity.Warning || markerHover.marker.severity === MarkerSeverity.Info) {
			disposables.add(this.renderAction(actionsElement, {
				label: nls.localize('peek problem', "Peek Problem"),
				commandId: NextMarkerAction.ID,
				run: () => {
					this.hide();
					MarkerController.get(this._editor).show(markerHover.marker);
					this._editor.focus();
				}
			}));
		}

		const quickfixPlaceholderElement = dom.append(actionsElement, $('div'));
		quickfixPlaceholderElement.style.opacity = '0';
		quickfixPlaceholderElement.style.transition = 'opacity 0.2s';
		setTimeout(() => quickfixPlaceholderElement.style.opacity = '1', 200);
		quickfixPlaceholderElement.textContent = nls.localize('checkingForQuickFixes', "Checking for quick fixes...");
		disposables.add(toDisposable(() => quickfixPlaceholderElement.remove()));


		const codeActionsPromise = this.getCodeActions(markerHover.marker);
		disposables.add(toDisposable(() => codeActionsPromise.cancel()));
		codeActionsPromise.then(actions => {
			quickfixPlaceholderElement.style.transition = '';
			quickfixPlaceholderElement.style.opacity = '1';

			if (!actions.validActions.length) {
				actions.dispose();
				quickfixPlaceholderElement.textContent = nls.localize('noQuickFixes', "No quick fixes available");
				return;
			}
			quickfixPlaceholderElement.remove();

			let showing = false;
			disposables.add(toDisposable(() => {
				if (!showing) {
					actions.dispose();
				}
			}));

			disposables.add(this.renderAction(actionsElement, {
				label: nls.localize('quick fixes', "Quick Fix..."),
				commandId: QuickFixAction.Id,
				run: (target) => {
					showing = true;
					const controller = QuickFixController.get(this._editor);
					const elementPosition = dom.getDomNodePagePosition(target);
					controller.showCodeActions(markerCodeActionTrigger, actions, {
						x: elementPosition.left + 6,
						y: elementPosition.top + elementPosition.height + 6
					});
				}
			}));
		});

		this.renderDisposable.value = disposables;
		return hoverElement;
	}

	private getCodeActions(marker: IMarker): CancelablePromise<CodeActionSet> {
		return createCancelablePromise(cancellationToken => {
			return getCodeActions(
				this._editor.getModel()!,
				new Range(marker.startLineNumber, marker.startColumn, marker.endLineNumber, marker.endColumn),
				markerCodeActionTrigger,
				cancellationToken);
		});
	}

	private renderAction(parent: HTMLElement, actionOptions: { label: string, iconClass?: string, run: (target: HTMLElement) => void, commandId: string }): IDisposable {
		const actionContainer = dom.append(parent, $('div.action-container'));
		const action = dom.append(actionContainer, $('a.action'));
		if (actionOptions.iconClass) {
			dom.append(action, $(`span.icon.${actionOptions.iconClass}`));
		}
		const label = dom.append(action, $('span'));
		label.textContent = actionOptions.label;
		const keybinding = this._keybindingService.lookupKeybinding(actionOptions.commandId);
		if (keybinding) {
			label.title = `${actionOptions.label} (${keybinding.getLabel()})`;
		}
		return dom.addDisposableListener(actionContainer, dom.EventType.CLICK, e => {
			e.stopPropagation();
			e.preventDefault();
			actionOptions.run(actionContainer);
		});
	}

	private static readonly _DECORATION_OPTIONS = ModelDecorationOptions.register({
		className: 'hoverHighlight'
	});
}

function hoverContentsEquals(first: HoverPart[], second: HoverPart[]): boolean {
	if ((!first && second) || (first && !second) || first.length !== second.length) {
		return false;
	}
	for (let i = 0; i < first.length; i++) {
		const firstElement = first[i];
		const secondElement = second[i];
		if (firstElement instanceof MarkerHover && secondElement instanceof MarkerHover) {
			return IMarkerData.makeKey(firstElement.marker) === IMarkerData.makeKey(secondElement.marker);
		}
		if (firstElement instanceof ColorHover || secondElement instanceof ColorHover) {
			return false;
		}
		if (firstElement instanceof MarkerHover || secondElement instanceof MarkerHover) {
			return false;
		}
		if (!markedStringsEquals(firstElement.contents, secondElement.contents)) {
			return false;
		}
	}
	return true;
}


import * as cp from 'child_process';
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { ICursorPositionChangedEvent } from 'vs/editor/common/controller/cursorEvents';
//import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IModelContentChangedEvent } from 'vs/editor/common/model/textModelEvents';
import { IEditorContribution, IScrollEvent } from 'vs/editor/common/editorCommon';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { EditorLayoutInfo } from 'vs/editor/common/config/editorOptions';
import * as strings from 'vs/base/common/strings';

// setInterval(() => {
// 	let editor_div = document.getElementsByClassName("monaco-editor")[0];
// 	if (editor_div === undefined)
// 		return;
// 	if (global_editor === undefined)
// 		return;
// 	//console.log(editor_div);
// 	if (box === undefined) {
// 		global_editor.onDidChangeCursorPosition(onChangeCursorPosition);
// 		global_editor.onDidChangeModelContent(onChangeModelContent);
// 		//global_editor.onDidScrollChange((e) => {console.log(e)});
// 		box = document.createElement('div');
// 		box.textContent = "AAA";
// 		box.style.position = "absolute";
// 		box.style.top = "100px";
// 		box.style.left = "100px";
// 		box.style.maxWidth = "1366px";
// 		box.style.transitionProperty = "all";
// 		box.style.transitionDuration = "0.3s";
// 		box.style.transitionDelay = "0s";
// 		box.style.transitionTimingFunction = "ease-in";
// 		//box.style.transform = "scale(2.5)";
// 		//box.style.zoom = "1";
// 		box.className = "monaco-editor-hover";
// 		editor_div.appendChild(box);
// 	} else {
// 		return;
// 		// let currpos = global_editor.getPosition();
// 		// if (currpos === null)
// 		// 	return;
// 		// let pixelP = global_editor.getScrolledVisiblePosition(currpos);
// 		// if (pixelP === null)
// 		// 	return;
// 		// // console.log(pixelP);
// 		// counter = counter + 1;
// 		// let zoom = 1.2 + (Math.sin(counter/50)*0.2);
// 		// box.style.top = (pixelP.top / zoom).toString() + "px";
// 		// box.style.left = ((pixelP.left+ 100) / zoom ).toString() + "px";
// 		// //console.log(zoom);
// 		// box.style.zoom = zoom.toString();
// 	}
// },20);

class RTVLine {
	private _div: HTMLDivElement;
	constructor(
		editor: ICodeEditor,
		x1: number,
		y1: number,
		x2: number,
		y2: number
	) {
		let editor_div = editor.getDomNode();
		if (editor_div === null) {
			throw new Error('Cannot find Monaco Editor');
		}

		this._div = document.createElement('div');
		this._div.style.position = "absolute";
		this._div.style.borderTop = "1px solid grey";
		this._div.style.transitionProperty = "all";
		this._div.style.transitionDuration = "0.3s";
		this._div.style.transitionDelay = "0s";
		this._div.style.transitionTimingFunction = "ease-in";
		this._div.style.transformOrigin = "0% 0%";
		this.move(x1,y1,x2,y2);
		editor_div.appendChild(this._div);
	}

	public destroy() {
		this._div.remove();
	}

	public move(x1: number, y1: number, x2: number, y2: number) {
		this._div.style.left = x1.toString() + "px";
		this._div.style.top = y1.toString() + "px";
		let deltaX = (x2 - x1);
		let deltaY = (y2 - y1);
		let length = Math.sqrt((deltaX * deltaX) + (deltaY * deltaY));
		this._div.style.width = length.toString() + "px";
		let angle = 0;
		if (length !== 0) {
			angle = Math.atan(deltaY / deltaX) * 180 / Math.PI;
		}
		this._div.style.transform = "rotate(" + angle.toString() + "deg)";
	}

	public setOpacity(opacity: number) {
		this._div.style.opacity = opacity.toString();
	}

	public hide(){
		this._div.style.display = "none";
	}

	public show(){
		this._div.style.display = "block";
	}

}

class RTVDisplayBox {
	private _box: HTMLDivElement;
	private _line: RTVLine;
	private _zoom: number = 1;
	private _opacity: number = 1;
	private _hiddenByUser: boolean = false;
	private _hasContent: boolean = false;
	constructor(
		private readonly _coordinator:RTVCoordinator,
		private readonly _editor: ICodeEditor,
		private readonly _modeService: IModeService,
		private readonly _openerService: IOpenerService | null,
		private _lineNumber: number
	) {
		let editor_div = this._editor.getDomNode();
		if (editor_div === null) {
			throw new Error('Cannot find Monaco Editor');
		}
		this._box = document.createElement('div');
		this._box.textContent = "";
		this._box.style.position = "absolute";
		this._box.style.top = "100px";
		this._box.style.left = "100px";
		this._box.style.maxWidth = "1366px";
		this._box.style.transitionProperty = "all";
		this._box.style.transitionDuration = "0.3s";
		this._box.style.transitionDelay = "0s";
		this._box.style.transitionTimingFunction = "ease-in";
		this._box.className = "monaco-editor-hover";
		this._box.onclick = (e) => {
			this.onClick(e);
		};
		editor_div.appendChild(this._box);
		this._line = new RTVLine(this._editor, 0, 0, 0, 0);
		this.hide();
	}

	get visible() {
		return !this._hiddenByUser && this._hasContent;
	}

	get hiddenByUser() {
		return this._hiddenByUser;
	}

	set hiddenByUser(h:boolean) {
		this._hiddenByUser = h;
	}

	get lineNumber() {
		return this._lineNumber;
	}

	set lineNumber(l:number) {
		this._lineNumber = l;
	}

	public destroy() {
		this._box.remove();
		this._line.destroy();
	}

	public hide() {
		this._hasContent = false;
		this._box.textContent = "";
		this._box.style.display = "none";
		this._line.hide();
	}

	public show() {
		this._hasContent = true;
		this._box.style.display = "block";
		this._line.show();
	}

	private onClick(e: MouseEvent) {
		e.stopImmediatePropagation();
		e.preventDefault();
		this._coordinator.flipVisMode(this._lineNumber);
	}

	public updateContent() {

		if (this._hiddenByUser) {
			this.hide();
			console.log("Hidden by user");
			return
		}

		// Get all envs at this line number
		let envsAtLine = this._coordinator.envs[this._lineNumber-1];
		if (envsAtLine === undefined) {
			this.hide();
			console.log("Did not find entry");
			return;
		}

		this.show();

		// collect all next step envs
		let envs: any[] = [];
		envsAtLine.forEach((env) => {
			if (env.next_lineno !== undefined) {
				let nextEnvs = this._coordinator.envs[env.next_lineno];
				if (nextEnvs !== undefined) {
					nextEnvs.forEach((nextEnv) => {
						if (nextEnv.time === env.time + 1) {
							envs.push(nextEnv);
						}
					});
				}
			}
		});

		// If this lines is a for loop, remove last env, which is the ending iteration of the for,
		// which does not execute
		let lineContent = this._coordinator.getLineContent(this._lineNumber).trim();
		if (strings.startsWith(lineContent, "for") && strings.endsWith(lineContent, ":")) {
			envs.pop();
		}

		// Compute set of keys in all envs
		let keys_set = new Set<string>();
		envs.forEach((env) => {
			for (let key in env) {
				if (key !== "prev_lineno" && key !== "next_lineno" && key !== "lineno" && key !== "time") {
					keys_set.add(key);
				}
			}
		});

		// Generate markdown table of all envs
		let header_line_1 = "|";
		let header_line_2 = "|";
		let header:string[] = [];
		keys_set.forEach((v:string) => {
			header_line_1 = header_line_1 + v + "|";
			header_line_2 = header_line_2 + "---|";
			header.push(v);
		});

		let mkdn = header_line_1 + "\n" + header_line_2 + "\n";

		//Stores the rows of the table
		let rows: string [][] = [];
		for (let i = 0; i < envs.length; i++) {
			let env = envs[i];
			let row:string [] = [];
			mkdn = mkdn + "|";
			keys_set.forEach((v:string) => {
				if (i === 0) {
					var v_str = env[v];
				} else if (env[v] === envs[i-1][v]) {
					var v_str:any = "&darr;";
				} else {
					var v_str = env[v];
				}
				row.push(v_str);
				mkdn = mkdn + v_str + "|";
			});
			rows.push(row);
			mkdn = mkdn + "\n";
		};

		// Update html content
		this._box.textContent = "";
		const renderer = new MarkdownRenderer(this._editor, this._modeService, this._openerService);

		//Creates the HTML Table and populates it
		let table = document.createElement('table');

		table.createTHead();
		if(table.tHead){
			let headerRow = table.tHead.insertRow(-1);
			header.forEach((h: string)=>{
				let newHeaderCell = headerRow.insertCell(-1);
				let renderedText = renderer.render(new MarkdownString("```python\n"+h+"```"));
				newHeaderCell.align = 'center';
				newHeaderCell.appendChild(renderedText.element);
			});
		}

		rows.forEach((row:string[]) =>{
			let newRow = table.insertRow(-1);
			row.forEach((item: string) => {
				let newCell = newRow.insertCell(-1);
				let renderedText = renderer.render(new MarkdownString("```python\n"+item+"```"));
				if(item === "&darr;"){
					renderedText = renderer.render(new MarkdownString(item));
				}
				newCell.align = 'center';
				newCell.appendChild(renderedText.element);
			});
		});

		//this._box.style.borderColor = 'rgb(200, 200, 200)';
		this._box.appendChild(table);

		// Add green/red dot to show out of date status
		let stopElement = document.createElement('div');
		stopElement.style.width = '5px';
		stopElement.style.height = '5px';
		stopElement.style.position = 'absolute';
		stopElement.style.top = '5px';
		stopElement.style.left = '3px';
		stopElement.style.borderRadius = '50%';
		let x = this._coordinator._changedLinesWhenOutOfDate;
		if (x === null) {
			stopElement.style.backgroundColor = 'green';
		} else {
			let green = 165 - (x.size-1) * 35;
			if (green < 0) {
				green = 0;
			}
			stopElement.style.backgroundColor = 'rgb(255,' + green.toString() + ',0)';
		}

		this._box.appendChild(stopElement);

	}

	public getHeight() {
		return this._box.offsetHeight*this._zoom;
	}

	public updateLayout(top: number) {

		let pixelPosAtLine = this._editor.getScrolledVisiblePosition(new Position(this._lineNumber, 1));
		let pixelPosAtNextLine = this._editor.getScrolledVisiblePosition(new Position(this._lineNumber+1, 1));
		if (pixelPosAtLine === null || pixelPosAtNextLine === null) {
			return;
		}

		let left = this._coordinator.maxPixelCol+230;
		let zoom_adjusted_left =  left - ((1-this._zoom) * (this._box.offsetWidth / 2));
		let zoom_adjusted_top = top - ((1-this._zoom) * (this._box.offsetHeight / 2));
		this._box.style.top = zoom_adjusted_top.toString() + "px";
		this._box.style.left = zoom_adjusted_left.toString() + "px";
		this._box.style.transform = "scale(" + this._zoom.toString() +")";
		this._box.style.opacity = this._opacity.toString();

		// update the line
		let midPointTop = (pixelPosAtLine.top + pixelPosAtNextLine.top)/2;
		this._line.move(this._coordinator.maxPixelCol+30, midPointTop, left, top);

	}

	public updateZoomAndOpacity(dist: number) {
		let distAbs = Math.abs(dist);
		this._zoom = 1 / (distAbs*0.5 + 1);
		//this._zoom = 1;

		if (this._coordinator._outOfDate === 0) {
			this._opacity = 1;
			if (distAbs !== 0) {
				this._opacity = 1/distAbs;
			}
			this._line.setOpacity(this._opacity);
		}
	}

	public fade() {
		let oldOpacity = this._box.style.opacity === "" ? '1' : this._box.style.opacity;
		if (oldOpacity) {
			let newOpacity = parseFloat(oldOpacity) * 0.9;
			this._box.style.opacity = newOpacity.toString();
			this._line.setOpacity(newOpacity);
			this._opacity = newOpacity;
		}
	}

	public updateBorder(opacity: number){
		this._box.style.borderColor = 'rgba(255, 0, 0, '+(this._coordinator._outOfDate/5)+')';
	}

}

enum VisibilityMode {
	AllBoxes,
	SingleBox
}

export class RTVCoordinator implements IEditorContribution {
	public envs: { [k:string]: any []; } = {};
	public rws: { [k:string]: string; } = {};
	private _boxes: RTVDisplayBox[] = [];
	private _maxPixelCol = 0;
	private _prevModel: string[] = [];
	private _visMode: VisibilityMode = VisibilityMode.AllBoxes;
	public _outOfDate: number = 0;
	public _changedLinesWhenOutOfDate: Set<number> | null = new Set();
	private _outOfDateTimerId: NodeJS.Timer | null = null;

	constructor(
		private readonly _editor: ICodeEditor,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IModeService private readonly _modeService: IModeService,
	) {
		this._editor.onDidChangeCursorPosition((e) => { this.onChangeCursorPosition(e); });
		this._editor.onDidScrollChange((e) => { this.onScrollChange(e); });
		this._editor.onDidLayoutChange((e) => { this.onLayoutChange(e); });
		this._editor.onDidChangeModelContent((e) => { this.onChangeModelContent(e); });
		for (let i = 0; i < this.getLineCount(); i++) {
			this._boxes.push(new RTVDisplayBox(this, _editor, _modeService, _openerService, i+1));
		}
		// for (let i = 0; i < this.getLineCount(); i++) {
		// 	this._boxes[i].hiddenByUser = true;
		// }
		// this._boxes[10].hiddenByUser = false;
		// this._boxes[5].hiddenByUser = false;
		this.updateMaxPixelCol();
		this.updatePrevModel();
	}

	public getId(): string {
		return 'editor.contrib.rtv';
	}

	public dispose(): void {

	}

	get maxPixelCol() {
		return this._maxPixelCol;
	}

	private getLineCount(): number {
		let model = this._editor.getModel();
		if (model === null) {
			return 0;
		}
		return model.getLineCount();
	}

	public getLineContent(lineNumber: number): string {
		let model = this._editor.getModel();
		if (model === null) {
			return "";
		}
		return model.getLineContent(lineNumber);
	}

	private updateMaxPixelCol() {
		let model = this._editor.getModel();
		if (model === null) {
			return;
		}
		let max = 0;
		let lineCount = model.getLineCount();
		for (let line = 1; line <= lineCount; line++) {
			let col = model.getLineMaxColumn(line);
			let pixelPos = this._editor.getScrolledVisiblePosition(new Position(line,col));
			if (pixelPos !== null && pixelPos.left > max) {
				max = pixelPos.left;
			}
		}
		this._maxPixelCol = max;
	}

	private updateLinesWhenOutOfDate(e: IModelContentChangedEvent, exitCode: number | null) {
		if (exitCode === 0) {
			this._changedLinesWhenOutOfDate = null;
		} else {
			if (this._changedLinesWhenOutOfDate === null) {
				this._changedLinesWhenOutOfDate = new Set();
			}
			let s = this._changedLinesWhenOutOfDate;
			e.changes.forEach((change) => {
				for (let i = change.range.startLineNumber; i <= change.range.endLineNumber; i++){
					s.add(i);
				}
			});
		}
	}

	private getBox(lineNumber:number) {
		let i = lineNumber - 1;
		if (i >= this._boxes.length) {
			for (let j = this._boxes.length; j <= i; j++) {
				this._boxes[j] = new RTVDisplayBox(this, this._editor, this._modeService, this._openerService, j+1);
			}
		}
		return this._boxes[i];
	}

	private padBoxArray() {
		let lineCount = this.getLineCount();
		if (lineCount > this._boxes.length) {
			// This should not happen, given our understanding of how changes are reported to us from VSCode.
			// BUT: just to be safe, we have this here to make sure we're not missing something.
			console.log("Warning: actually had to add boxes");
			for (let j = this._boxes.length; j < lineCount; j++) {
				this._boxes[j] = new RTVDisplayBox(this, this._editor, this._modeService, this._openerService, j+1);
			}
		}
	}

	private onChangeCursorPosition(e: ICursorPositionChangedEvent) {
		this.updateLayout();
	}

	private onScrollChange(e:IScrollEvent) {
		if (e.scrollHeightChanged || e.scrollWidthChanged) {
			// this means the content also changed, so we will let the onChangeModelContent event handle it
			return;
		}
		this.updateMaxPixelCol();
		this.updateLayout();
	}

	private onLayoutChange(e: EditorLayoutInfo) {
		console.log("onLayoutChange");
		this.updateMaxPixelCol();
		this.updateLayout();
	}

	private updateContentAndLayout() {
		this.updateContent();
		// The following seems odd, but it's really a thing in browsers.
		// We need to let layout threads catch up after we updated content to
		// get the correct sizes for boxes.
		setTimeout(() => { this.updateLayout(); }, 0);
	}

	private updateContent() {
		this.padBoxArray();
		this._boxes.forEach((b) => {
			b.updateContent();
		});
	}

	private updateLayout() {
		this.padBoxArray();
		// this._boxes.forEach((b) => {
		// 	b.updateZoomAndOpacity();
		// });

		let cursorPos = this._editor.getPosition();
		if (cursorPos === null) {
			return;
		}

		// Compute focused line, which is the closest line to the cursor with a visible box
		let minDist = Infinity;
		let focusedLine = 0;
		for (let line = 1; line <= this.getLineCount(); line++) {
			if (this.getBox(line).visible) {
				let dist = Math.abs(cursorPos.lineNumber - line);
				if (dist <  minDist) {
					minDist = dist;
					focusedLine = line;
				}
			}
		}
		// this can happen if no boxes are visible
		if (minDist === Infinity) {
			return
		}

		// compute distances from focused line, ignoring hidden lines.
		// Start from focused line and go outward.
		let distancesFromFocus: number[] = new Array(this._boxes.length);
		let dist = 0;
		for (let line = focusedLine; line >= 1; line--) {
			if (this.getBox(line).visible) {
				distancesFromFocus[line-1] = dist;
				dist = dist - 1;
			}
		}
		dist = 1;
		for (let line = focusedLine+1; line <= this.getLineCount(); line++) {
			if (this.getBox(line).visible) {
				distancesFromFocus[line-1] = dist;
				dist = dist + 1;
			}
		}

		for (let line = 1; line <= this.getLineCount(); line++) {
			let box = this.getBox(line);
			if (box.visible) {
				box.updateZoomAndOpacity(distancesFromFocus[line-1]);
			}
		}
		// let cursorPixelPos = this._editor.getScrolledVisiblePosition(cursorPos);
		// let nextLinePixelPos = this._editor.getScrolledVisiblePosition(new Position(cursorPos.lineNumber+1,cursorPos.column));
		// if (cursorPixelPos === null || nextLinePixelPos === null) {
		// 	return;
		// }

		let focusedLinePixelPos = this._editor.getScrolledVisiblePosition(new Position(focusedLine, 1));
		let nextLinePixelPos = this._editor.getScrolledVisiblePosition(new Position(focusedLine+1, 1));
		if (focusedLinePixelPos === null || nextLinePixelPos === null) {
			return;
		}

		let top_start = (focusedLinePixelPos.top + nextLinePixelPos.top) / 2;
		let top = top_start;
		for (let line = focusedLine-1; line >= 1; line--) {
			let box = this.getBox(line);
			if (box.visible) {
				top = top - 20 - box.getHeight();
				box.updateLayout(top);
			}
		}
		top = top_start;
		for (let line = focusedLine; line <= this.getLineCount(); line++) {
			let box = this.getBox(line);
			if (box.visible) {
				box.updateLayout(top);
				top = top + box.getHeight() + 20;
			}
		}

	}

	private updatePrevModel() {
		let model = this._editor.getModel();
		if (model !== null) {
			this._prevModel = model.getLinesContent().map((x) => x);
		}
	}

	public getLineLastNonWhitespaceColumn(lineNumber: number): number {
		const result = strings.lastNonWhitespaceIndex(this._prevModel[lineNumber-1]);
		if (result === -1) {
			return 0;
		}
		return result + 2;
	}

	private addRemoveBoxes(e: IModelContentChangedEvent) {
		let orig = this._boxes.map((x) => x);
		let changes = e.changes.sort((a,b) => Range.compareRangesUsingStarts(a.range,b.range));
		console.log(changes);
		let changeIdx = 0;
		let origIdx = 0;
		let i = 0;
		while (i < this.getLineCount()) {
			if (changeIdx >= changes.length) {
				this._boxes[i++] = orig[origIdx++];
				this._boxes[i-1].lineNumber = i;
			} else {
				let line = i + 1;
				let change = changes[changeIdx];
				let numAddedLines = change.text.split("\n").length-1;
				let changeStartLine = change.range.startLineNumber;
				let changeEndLine = change.range.endLineNumber;
				let numRemovedLines = changeEndLine - changeStartLine;
				let deltaNumLines = numAddedLines - numRemovedLines;
				let changeStartCol = change.range.startColumn;
				if ((deltaNumLines <= 0 && changeStartLine === line) ||
					(deltaNumLines > 0 && ((changeStartLine === line && changeStartCol < this.getLineLastNonWhitespaceColumn(line)) ||
						 				   (changeStartLine === line-1 && changeStartCol >= this.getLineLastNonWhitespaceColumn(line-1))))) {
					changeIdx++;
					if (deltaNumLines === 0) {
						// nothing to do
					} else if (deltaNumLines > 0) {
						for (let j = 0; j < deltaNumLines; j++) {
							let new_box = new RTVDisplayBox(this, this._editor, this._modeService, this._openerService, i+1);
							//new_box.hiddenByUser = orig[origIdx].hiddenByUser;
							new_box.hiddenByUser = this._visMode == VisibilityMode.SingleBox;
							this._boxes[i++] = new_box;
						}
					} else {
						for (let j = origIdx; j < origIdx + (-deltaNumLines); j++) {
							this._boxes[j].destroy();
						}
						// need to make the removed boxes disapear
						origIdx = origIdx + (-deltaNumLines);
					}
				}
				else {
					this._boxes[i++] = orig[origIdx++];
					this._boxes[i-1].lineNumber = i;
				}
			}

		}
		this.updatePrevModel();
	}

	private onChangeModelContent(e: IModelContentChangedEvent) {
		let py3 = process.env["PYTHON3"];
		if (py3 === undefined) {
			return;
		}
		let runpy = process.env["RUNPY"];
		if (runpy === undefined) {
			return;
		}
		console.log("onChangeModelContent");
		//console.log(e);
		this.padBoxArray();
		this.addRemoveBoxes(e);
		this.updateMaxPixelCol();
		let code_fname = os.tmpdir() + path.sep + "tmp.py";
		let model = this._editor.getModel();
		if (model === null) {
			return;
		}
		let lines = model.getLinesContent();
		fs.writeFileSync(code_fname, lines.join("\n"));
		let c = cp.spawn(py3, [runpy, code_fname]);

		c.stdout.on("data", (data) => {
			//console.log(data.toString())
		});
		c.stderr.on("data", (data) => {
			//console.log(data.toString())
		});
		c.on('exit', (exitCode, signalCode) => {
			console.log("Exit code from run.py: " + exitCode);
			this.updateLinesWhenOutOfDate(e, exitCode);
			if (exitCode === 0) {
				this._outOfDate = 0;
				// if (this._outOfDateTimerId !== null) {
				// 	clearInterval(this._outOfDateTimerId);
				// 	this._outOfDateTimerId = null;
				// }
				this.updateData(fs.readFileSync(code_fname + ".out").toString());
				this.updateContentAndLayout();
				//console.log(envs);
			}
			else if (this._outOfDateTimerId === null) {
				this._outOfDate++;
				this.updateContentAndLayout();
				// this._outOfDateTimerId = setInterval(() => {
				// 	this.onOutOfDate();
				// }, 300);
			}
		});

	}

	private onOutOfDate(){
		this._outOfDate++;
		this._boxes.forEach((box: RTVDisplayBox) => {
			box.fade();
			//box.updateBorder(this._outOfDate);
		});
	}

	private updateData(str: string) {
		let data = JSON.parse(str);
		this.envs = data[1];
		this.rws = data[0];
	}

	public flipVisMode(line: number) {
		if (this._visMode == VisibilityMode.AllBoxes) {
			this._visMode = VisibilityMode.SingleBox;
			this._boxes.forEach((b) => {
				b.hiddenByUser = (b.lineNumber !== line);
			});
		} else {
			this._visMode = VisibilityMode.AllBoxes;
			this._boxes.forEach((b) => {
				b.hiddenByUser = false;
			});
		}
		this.updateContentAndLayout();
	}

	// public focusOnBox(line: number) {
	// 	console.log("In focusOnBox: " + line.toString())
	// 	this._boxes.forEach((b) => {
	// 		b.hiddenByUser = (b.lineNumber !== line);
	// 	});
	// 	this.updateContentAndLayout();
	// }

}

registerEditorContribution(RTVCoordinator);