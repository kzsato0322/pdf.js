/*
 * R.Sato
 * 線アノテーションエディタ
 */

import {
  AnnotationEditorParamsType,
  AnnotationEditorType,
  assert,
  Util,
} from "../../shared/util.js";
import { AnnotationEditor } from "./editor.js";
import { LineAnnotationElement } from "../annotation_layer.js";
import { noContextMenu } from "../display_utils.js";
import { opacityToHex } from "./tools.js";

/**
 * Basic draw editor in order to generate an line annotation.
 */
class LineEditor extends AnnotationEditor {
  // ベースPDF高さ
  #baseHeight = 0;

  // ベースPDF幅
  #baseWidth = 0;

  // CanvasContextタイムアウトID
  #canvasContextMenuTimeoutId = null;

  // 現在描画中path2D
  #currentPath2D = new Path2D();

  // 描画終了フラグ
  #disableEditing = false;

  // 描画中止コントローラ
  #drawingAC = null;

  // 描画対象有無
  #hasSomethingToDraw = false;

  // Canvas初期化済フラグ
  #isCanvasInitialized = false;

  // リサイズ（スケーリング）監視
  #observer = null;

  // マウスDOWN用AC
  #pointerdownAC = null;

  // 実幅
  #realWidth = 0;

  // 実高さ
  #realHeight = 0;

  // 
  #requestFrameCallback = null;

  // 描画色
  static _defaultColor = null;

  // 描画透過度
  static _defaultOpacity = 1;

  // 描画太さ
  static _defaultThickness = 1;

  // 描画タイプ
  static _type = "line";

  // エディタタイプ
  static _editorType = AnnotationEditorType.LINE;

  // コンストラクタ
  constructor(params) {
    // アノテーションエディタを線描画で生成
    super({ ...params, name: "lineEditor" });
    // 色指定
    this.color = params.color || null;
    // 太さ指定
    this.thickness = params.thickness || null;
    // 透過率指定
    this.opacity = params.opacity || null;
    // アノテーションパス配列
    this.paths = [];
    // 曲線パス配列
    this.bezierPath2D = [];
    // 全RAWパス配列
    this.allRawPaths = [];
    // 描画中パス配列
    this.currentPath = [];
    // 拡大
    this.scaleFactor = 1;
    // 移動位置座標
    this.translationX = this.translationY = 0;
    // X座標
    this.x = 0;
    // Y座標
    this.y = 0;
    // アスペクト比保持有無（縦横比の保持）
    this._willKeepAspectRatio = true;
  }

  /**
   * アノテーションエディタ初期化
   * @param {*} l10n
   * @param {*} uiManager
   * @inheritdoc
   */
  static initialize(l10n, uiManager) {
    AnnotationEditor.initialize(l10n, uiManager);
  }

  /**
   * アノテーションデフォルトパラメータ更新
   * @param {*} type アノテーションパラメータタイプ
   * @param {*} value アノテーションパラメータ値
   * @inheritdoc
   */
  static updateDefaultParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.LINE_THICKNESS:
        LineEditor._defaultThickness = value;
        break;
      case AnnotationEditorParamsType.LINE_COLOR:
        LineEditor._defaultColor = value;
        break;
      case AnnotationEditorParamsType.LINE_OPACITY:
        LineEditor._defaultOpacity = value / 100;
        break;
    }
  }

  /**
   * アノテーションパラメータ更新
   * @param {*} type アノテーションパラメータタイプ
   * @param {*} value アノテーションパラメータ値
   * @inheritdoc
   */
  updateParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.LINE_THICKNESS:
        this.#updateThickness(value);
        break;
      case AnnotationEditorParamsType.LINE_COLOR:
        this.#updateColor(value);
        break;
      case AnnotationEditorParamsType.LINE_OPACITY:
        this.#updateOpacity(value);
        break;
    }
  }

  /**
   * アノテーションデフォルトパラメータ取得
   * @returns パラメータ配列[太さ、色、透過度]
   * @inheritdoc
   */
  static get defaultPropertiesToUpdate() {
    return [
      [AnnotationEditorParamsType.LINE_THICKNESS, LineEditor._defaultThickness],
      [
        AnnotationEditorParamsType.LINE_COLOR,
        LineEditor._defaultColor || AnnotationEditor._defaultLineColor,
      ],
      [
        AnnotationEditorParamsType.LINE_OPACITY,
        Math.round(LineEditor._defaultOpacity * 100),
      ],
    ];
  }

  /**
   * アノテーションプロパティ情報取得
   * @returns プロパティ情報配列[太さ、色、透過度]
   * @inheritdoc
   */
  get propertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.LINE_THICKNESS,
        this.thickness || LineEditor._defaultThickness,
      ],
      [
        AnnotationEditorParamsType.LINE_COLOR,
        this.color ||
          LineEditor._defaultColor ||
          AnnotationEditor._defaultLineColor,
      ],
      [
        AnnotationEditorParamsType.LINE_OPACITY,
        Math.round(100 * (this.opacity ?? LineEditor._defaultOpacity)),
      ],
    ];
  }

  /**
   * アノテーションパラメータの太さ更新＆復元設定
   * @param {number} thickness 太さ
   */
  #updateThickness(thickness) {
    const setThickness = th => {
      this.thickness = th;
      this.#fitToContent();
    };
    const savedThickness = this.thickness;
    this.addCommands({
      cmd: setThickness.bind(this, thickness),
      undo: setThickness.bind(this, savedThickness),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.LINE_THICKNESS,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  /**
   * アノテーションパラメータの色更新＆復元設定
   * @param {string} color 色
   */
  #updateColor(color) {
    const setColor = col => {
      this.color = col;
      this.#redraw();
    };
    const savedColor = this.color;
    this.addCommands({
      cmd: setColor.bind(this, color),
      undo: setColor.bind(this, savedColor),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.LINE_COLOR,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  /**
   * アノテーションパラメータの透過度の更新＆復元設定
   * @param {number} opacity
   */
  #updateOpacity(opacity) {
    const setOpacity = op => {
      this.opacity = op;
      this.#redraw();
    };
    opacity /= 100;
    const savedOpacity = this.opacity;
    this.addCommands({
      cmd: setOpacity.bind(this, opacity),
      undo: setOpacity.bind(this, savedOpacity),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.LINE_OPACITY,
      overwriteIfSameType: true,
      keepUndo: true,
    });
  }

  /**
   * アノテーション描画環境再構築
   * @returns
   * @inheritdoc
   */
  rebuild() {
    // ベースPDFが存在しない場合
    if (!this.parent) {
      // 何もしない
      return;
    }
    // 線描画エディタ再構築
    super.rebuild();
    if (this.div === null) {
      return;
    }
    // 線アノテーション用のCanvasが未生成の場合
    if (!this.canvas) {
      // 線アノテーション用Canvas生成
      this.#createCanvas();
      // 線アノテーションリサイズ監視制御生成
      this.#createObserver();
    }
    // ベースPDFに付属させていない場合
    if (!this.isAttachedToDOM) {
      // ベースPDFに付属させる
      this.parent.add(this);
      // Canvasサイズ設定
      this.#setCanvasDims();
    }
    this.#fitToContent();
  }

  // 解放制御
  /** @inheritdoc */
  remove() {
    // Canvasが未生成の場合
    if (this.canvas === null) {
      // 何もしない
      return;
    }
    // アノテーションが生成済みの場合
    if (!this.isEmpty()) {
      // コミット処理（PDF保存）
      this.commit();
    }

    // 線アノテーション用Canvas解放
    this.canvas.width = this.canvas.height = 0;
    this.canvas.remove();
    this.canvas = null;

    if (this.#canvasContextMenuTimeoutId) {
      clearTimeout(this.#canvasContextMenuTimeoutId);
      this.#canvasContextMenuTimeoutId = null;
    }

    // リサイズ監視切断
    this.#observer?.disconnect();
    // リサイズ監視クリア
    this.#observer = null;
    // 線エディタ解放
    super.remove();
  }

  setParent(parent) {
    if (!this.parent && parent) {
      // We've a parent hence the rescale will be handled thanks to the
      // ResizeObserver.
      this._uiManager.removeShouldRescale(this);
    } else if (this.parent && parent === null) {
      // The editor is removed from the DOM, hence we handle the rescale thanks
      // to the onScaleChanging callback.
      // This way, it'll be saved/printed correctly.
      this._uiManager.addShouldRescale(this);
    }
    super.setParent(parent);
  }

  /**
   * スケール変更処理
   */
  onScaleChanging() {
    const [parentWidth, parentHeight] = this.parentDimensions;
    const width = this.width * parentWidth;
    const height = this.height * parentHeight;
    this.setDimensions(width, height);
  }

  /**
   * 線アノテーションエディットモード設定
   * @returns
   * @inheritdoc
   */
  enableEditMode() {
    // 描画終了または、Canvasが未生成の場合
    if (this.#disableEditing || this.canvas === null) {
      // 何もしない
      return;
    }
    // アノテーションエディットモードON
    super.enableEditMode();
    this._isDraggable = false;
    this.#addPointerdownListener();
  }

  /**
   * アノテーションエディットモード解除
   * @returns
   * @inheritdoc
   */
  disableEditMode() {
    // エディットモード中以外または、Canvasが未生成の場合
    if (!this.isInEditMode() || this.canvas === null) {
      // 何もしない
      return;
    }
    // アノテーションエディットモードOFF
    super.disableEditMode();
    this._isDraggable = !this.isEmpty();
    // DIVのクラスからeditingを除去
    this.div.classList.remove("editing");
    this.#removePointerdownListener();
  }

  /**
   * ドラッグ可能設定
   * @inheritdoc
   */
  onceAdded() {
    this._isDraggable = !this.isEmpty();
  }

  // アノテーション存在チェック
  // アノテーションが存在していなければ、trueを返す
  /** @inheritdoc */
  isEmpty() {
    // アノテーションが未生成または、アノテーションが１で生成途中の場合
    // trueを返す
    return (
      this.paths.length === 0 ||
      (this.paths.length === 1 && this.paths[0].length === 0)
    );
  }

  /**
   * ベースPDFのボックス情報取得
   * @returns {xpos, ypos, height, width}のオブジェクト
   */
  #getInitialBBox() {
    const {
      parentRotation,
      parentDimensions: [width, height],
    } = this;
    // ローテーションを判定
    switch (parentRotation) {
      case 90: // 90度の場合
        return [0, height, height, width];
      case 180: // 180度の場合
        return [width, height, width, height];
      case 270: // 270度の場合
        return [width, 0, height, width];
      default: // 0度の場合
        return [0, 0, width, height];
    }
  }

  /**
   * アノテーション選択状態の描画スタイル設定
   * @param なし
   */
  #setStroke() {
    const { ctx, color, opacity, thickness, parentScale, scaleFactor } = this;
    ctx.lineWidth = (thickness * parentScale) / scaleFactor;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.miterLimit = 10;
    ctx.strokeStyle = `${color}${opacityToHex(opacity)}`;
  }

  /**
   * 未確定の線の描画開始処理
   * @param {number} x
   * @param {number} y
   */
  #startDrawing(x, y) {
    // コンテキストメニュイベント生成
    this.canvas.addEventListener("contextmenu", noContextMenu, {
      signal: this._uiManager._signal,
    });
    // マウスDOWNイベント設定削除
    this.#removePointerdownListener();

    if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
      assert(
        !this.#drawingAC,
        "No `this.#drawingAC` AbortController should exist."
      );
    }
    // 描画中止コントローラ設定
    this.#drawingAC = new AbortController();
    // 描画中止シグナル設定
    const signal = this._uiManager.combinedSignal(this.#drawingAC);

    // Canvasからポインタ（マウス）がはみ出た時のイベント生成
    this.canvas.addEventListener(
      "pointerleave",
      // Canvas内ポインタ離脱処理
      this.canvasPointerleave.bind(this),
      { signal }
    );
    // Canvas内でポインタ移動（マウス位置移動）のイベント生成
    this.canvas.addEventListener(
      "pointermove",
      // Canvas内ポインタ移動処理
      this.canvasPointermove.bind(this),
      { signal }
    );
    // Canvas内でのポインタUP（マウスボタンUP）のイベント生成
    this.canvas.addEventListener(
      "pointerup",
      // Canvas内ポインタUP処理
      this.canvasPointerup.bind(this),
      { signal }
    );

    // 描画中フラグON
    this.isEditing = true;
    // Canvasが未初期化の場合
    if (!this.#isCanvasInitialized) {
      // Canvasを初期化済に設定
      this.#isCanvasInitialized = true;
      // Canvasサイズ設定
      this.#setCanvasDims();
      // 描画太さ設定
      this.thickness ||= LineEditor._defaultThickness;
      // 描画色設定
      this.color ||=
        LineEditor._defaultColor || AnnotationEditor._defaultLineColor;
      // 描画透過度設定
      this.opacity ??= LineEditor._defaultOpacity;
    }
    // currentPathに最初のx,y座標を保存
    this.currentPath.push([x, y]);
    // 描画対象有無をfalse
    this.#hasSomethingToDraw = false;
    // 線のスタイル設定
    this.#setStroke();
    // 描画要求コールバック
    this.#requestFrameCallback = () => {
      // 描画位置指定
      this.#drawPoints();
      // 再描画要求コールバック設定済ならば、再描画を行う
      if (this.#requestFrameCallback) {
        window.requestAnimationFrame(this.#requestFrameCallback);
      }
    };
    // 再描画を行う
    window.requestAnimationFrame(this.#requestFrameCallback);
  }

  /**
   * 未確定の線の描画処理
   * @param {number} x
   * @param {number} y
   */
  #draw(x, y) {
    // const [lastX, lastY] = this.currentPath.at(-1);
    // if (this.currentPath.length > 1 && x === lastX && y === lastY) {
    //   return;
    // }
    // const currentPath = this.currentPath;
    // let path2D = this.#currentPath2D;
    // currentPath.push([x, y]);
    // this.#hasSomethingToDraw = true;

    // if (currentPath.length <= 2) {
    //   path2D.moveTo(...currentPath[0]);
    //   path2D.lineTo(x, y);
    //   return;
    // }

    // if (currentPath.length === 3) {
    //   this.#currentPath2D = path2D = new Path2D();
    //   path2D.moveTo(...currentPath[0]);
    // }

    // this.#makeBezierCurve(
    //   path2D,
    //   ...currentPath.at(-3),
    //   ...currentPath.at(-2),
    //   x,
    //   y
    // );

    // 前回mouseDownしたX,y座標を取得
    const [lastX, lastY] = this.currentPath.at(-1);
    // currentPathにX,Y座標の登録があり＆今のx,y座標と前回が同じ場合
    if (this.currentPath.length > 1 && x === lastX && y === lastY) {
      // 何もしない
      return;
    }
    const currentPath = this.currentPath;
    // 前回currentPathにPUSHしている（mouseDown後に２回目以降のmouseMove）の場合
    if (this.currentPath.length > 1) {
      // 前回のcurrentPathへのx,y座標を削除
      this.currentPath.pop();
      const { ctx } = this;
      const thickness = Math.ceil(this.thickness * this.parentScale);
      const lastPoints = this.currentPath.slice(-3);
      const xx = lastPoints.map(xy => xy[0]);
      const yy = lastPoints.map(xy => xy[1]);
      const xMin = Math.min(...xx) - thickness;
      const xMax = Math.max(...xx) + thickness;
      const yMin = Math.min(...yy) - thickness;
      const yMax = Math.max(...yy) + thickness;
      // Canvasの描画をクリア
      if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL")) {
        // In Chrome, the clip() method doesn't work as expected.
        ctx.clearRect(xMin, yMin, xMax - xMin, yMax - yMin);
        ctx.beginPath();
        ctx.rect(xMin, yMin, xMax - xMin, yMax - yMin);
        ctx.clip();
      } else {
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }
    const path2D = this.#currentPath2D;
    // 今回のx,y座標をcurrentPathにPUSH
    this.currentPath.push([x, y]);
    this.#hasSomethingToDraw = true;

    // 最初にmouseDownしたx,y座標に位置付ける
    path2D.moveTo(...currentPath[0]);
    // 今回のx,y座標まで線を描画する
    path2D.lineTo(x, y);
  }

  /**
   * 未確定の線の確定描画処理
   */
  #fixDraw() {
    const { ctx } = this;
    const thickness = Math.ceil(this.thickness * this.parentScale);
    const lastPoints = this.currentPath.slice(-3);
    const xx = lastPoints.map(xy => xy[0]);
    const yy = lastPoints.map(xy => xy[1]);
    const xMin = Math.min(...xx) - thickness;
    const xMax = Math.max(...xx) + thickness;
    const yMin = Math.min(...yy) - thickness;
    const yMax = Math.max(...yy) + thickness;
    // Canvasの描画をクリア
    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL")) {
      // In Chrome, the clip() method doesn't work as expected.
      ctx.clearRect(xMin, yMin, xMax - xMin, yMax - yMin);
      ctx.beginPath();
      ctx.rect(xMin, yMin, xMax - xMin, yMax - yMin);
      ctx.clip();
    } else {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    const path2D = this.#currentPath2D;
    this.#hasSomethingToDraw = true;
    // currentPathの2番目のx,y座標を取得
    const [lastX, lastY] = this.currentPath[1];
    // 最初にmouseDownしたx,y座標に位置付ける
    path2D.moveTo(...this.currentPath[0]);
    // 最後のx,y座標まで線を描画する
    path2D.lineTo(lastX, lastY);
  }

  // アノテーション用Canvasに描画
  #endPath() {
    // currentPathに未設定の場合
    if (this.currentPath.length === 0) {
      // 何もしない
      return;
    }
    // currentPathの最初（０番目）から最後（１番目）までアノテーション用Canvasに線を描画
    const lastPoint = this.currentPath.at(0);
    this.#currentPath2D.lineTo(...lastPoint);
  }

  /**
   * 線の描画終了
   * @param {number} x
   * @param {number} y
   */
  #stopDrawing(x, y) {
    // 再描画要求コールバック設定クリア
    this.#requestFrameCallback = null;
    // 最終x,y座標算出
    x = Math.min(Math.max(x, 0), this.canvas.width);
    y = Math.min(Math.max(y, 0), this.canvas.height);
    // 最終x,y座標まで線を描画
    this.#draw(x, y);
    // アノテーション用Canvasに描画
    this.#endPath();

    // Interpolate the path entered by the user with some
    // Bezier's curves in order to have a smoother path and
    // to reduce the data size used to draw it in the PDF.
    let bezier;
    if (this.currentPath.length !== 1) {
      bezier = this.#generateBezierPoints();
    } else {
      // We have only one point finally.
      const xy = [x, y];
      bezier = [[xy, xy.slice(), xy.slice(), xy]];
    }
    const path2D = this.#currentPath2D;
    const currentPath = this.currentPath;
    this.currentPath = [];
    this.#currentPath2D = new Path2D();

    const cmd = () => {
      this.allRawPaths.push(currentPath);
      this.paths.push(bezier);
      this.bezierPath2D.push(path2D);
      this._uiManager.rebuild(this);
    };

    // 復活処理定義
    const undo = () => {
      this.allRawPaths.pop();
      this.paths.pop();
      this.bezierPath2D.pop();
      if (this.paths.length === 0) {
        this.remove();
      } else {
        if (!this.canvas) {
          // 線アノテーション用Canvas生成
          this.#createCanvas();
          // 線アノテーションリサイズ監視制御生成
          this.#createObserver();
        }
        this.#fitToContent();
      }
    };

    this.addCommands({ cmd, undo, mustExec: true });
  }

  // 描画位置指定
  #drawPoints() {
    if (!this.#hasSomethingToDraw) {
      return;
    }
    this.#hasSomethingToDraw = false;

    const thickness = Math.ceil(this.thickness * this.parentScale);
    const lastPoints = this.currentPath.slice(-3);
    const x = lastPoints.map(xy => xy[0]);
    const y = lastPoints.map(xy => xy[1]);
    const xMin = Math.min(...x) - thickness;
    const xMax = Math.max(...x) + thickness;
    const yMin = Math.min(...y) - thickness;
    const yMax = Math.max(...y) + thickness;

    const { ctx } = this;
    ctx.save();

    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL")) {
      // In Chrome, the clip() method doesn't work as expected.
      ctx.clearRect(xMin, yMin, xMax - xMin, yMax - yMin);
      ctx.beginPath();
      ctx.rect(xMin, yMin, xMax - xMin, yMax - yMin);
      ctx.clip();
    } else {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    for (const path of this.bezierPath2D) {
      ctx.stroke(path);
    }
    ctx.stroke(this.#currentPath2D);

    ctx.restore();
  }

  // #makeBezierCurve(path2D, x0, y0, x1, y1, x2, y2) {
  //   const prevX = (x0 + x1) / 2;
  //   const prevY = (y0 + y1) / 2;
  //   const x3 = (x1 + x2) / 2;
  //   const y3 = (y1 + y2) / 2;

  //   path2D.bezierCurveTo(
  //     prevX + (2 * (x1 - prevX)) / 3,
  //     prevY + (2 * (y1 - prevY)) / 3,
  //     x3 + (2 * (x1 - x3)) / 3,
  //     y3 + (2 * (y1 - y3)) / 3,
  //     x3,
  //     y3
  //   );
  // }

  #generateBezierPoints() {
    const path = this.currentPath;
    if (path.length <= 2) {
      return [[path[0], path[0], path.at(-1), path.at(-1)]];
    }

    const bezierPoints = [];
    let i;
    let [x0, y0] = path[0];
    for (i = 1; i < path.length - 2; i++) {
      const [x1, y1] = path[i];
      const [x2, y2] = path[i + 1];
      const x3 = (x1 + x2) / 2;
      const y3 = (y1 + y2) / 2;

      // The quadratic is: [[x0, y0], [x1, y1], [x3, y3]].
      // Convert the quadratic to a cubic
      // (see https://fontforge.org/docs/techref/bezier.html#converting-truetype-to-postscript)
      const control1 = [x0 + (2 * (x1 - x0)) / 3, y0 + (2 * (y1 - y0)) / 3];
      const control2 = [x3 + (2 * (x1 - x3)) / 3, y3 + (2 * (y1 - y3)) / 3];

      bezierPoints.push([[x0, y0], control1, control2, [x3, y3]]);

      [x0, y0] = [x3, y3];
    }

    const [x1, y1] = path[i];
    const [x2, y2] = path[i + 1];

    // The quadratic is: [[x0, y0], [x1, y1], [x2, y2]].
    const control1 = [x0 + (2 * (x1 - x0)) / 3, y0 + (2 * (y1 - y0)) / 3];
    const control2 = [x2 + (2 * (x1 - x2)) / 3, y2 + (2 * (y1 - y2)) / 3];

    bezierPoints.push([[x0, y0], control1, control2, [x2, y2]]);
    return bezierPoints;
  }

  /**
   * Redraw all the paths.
   */
  #redraw() {
    // アノテーションが未生成の場合
    if (this.isEmpty()) {
      this.#updateTransform();
      return;
    }
    this.#setStroke();

    const { canvas, ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.#updateTransform();

    for (const path of this.bezierPath2D) {
      ctx.stroke(path);
    }
  }

  /**
   * コミット処理
   * PDFストレージにアノテーション情報を格納
   */
  commit() {
    // 線アノテーションが描画終了の場合
    if (this.#disableEditing) {
      // 何もしない
      return;
    }

    // コミット処理
    super.commit();
    // エディット中フラグOFF
    this.isEditing = false;
    // エディット中解除
    this.disableEditMode();
    // 描画対象のCanvasを前面にする
    this.setInForeground();
    // エディット無効フラグON
    this.#disableEditing = true;
    // DIVのクラスにdisabledを設定
    this.div.classList.add("disabled");
    // DIVに内容を設定
    this.#fitToContent(/* firstTime = */ true);
    this.select();

    this.parent.addLineEditorIfNeeded(/* isCommitting = */ true);

    // When committing, the position of this editor is changed, hence we must
    // move it to the right position in the DOM.
    this.moveInDOM();
    this.div.focus({
      preventScroll: true /* See issue #15744 */,
    });
  }

  /** @inheritdoc */
  focusin(event) {
    if (!this._focusEventsAllowed) {
      return;
    }
    super.focusin(event);
    this.enableEditMode();
  }

  // Canvas内ポインタDOWNイベント設定処理
  #addPointerdownListener() {
    if (this.#pointerdownAC) {
      return;
    }
    // ポインタDOWN中止コントローラ設定
    this.#pointerdownAC = new AbortController();
    // ポインタDOWN中止シグナル設定
    const signal = this._uiManager.combinedSignal(this.#pointerdownAC);

    // Canvas内でのポインタDOWN（マウスボタンDOWN）イベント生成
    this.canvas.addEventListener(
      "pointerdown",
      // Canvas内ポインタDOWN処理
      this.canvasPointerdown.bind(this),
      { signal }
    );
  }

  // Canvas内ポインタDOWNイベント削除
  #removePointerdownListener() {
    this.pointerdownAC?.abort();
    this.pointerdownAC = null;
  }

  /**
   * Canvas内ポインタDOWN処理
   * @param {PointerEvent} event
   */
  canvasPointerdown(event) {
    // イベントがボタンでない、または描画モード中ではない、または描画終了の時
    if (event.button !== 0 || !this.isInEditMode() || this.#disableEditing) {
      // 何もしない
      return;
    }

    // 描画対象のCanvasを前面にする
    this.setInForeground();

    event.preventDefault();

    if (!this.div.contains(document.activeElement)) {
      this.div.focus({
        preventScroll: true /* See issue #17327 */,
      });
    }

    // 未確定の線の描画開始処理
    this.#startDrawing(event.offsetX, event.offsetY);
  }

  /**
   * Canvas内ポインタ移動処理
   * @param {PointerEvent} event
   */
  canvasPointermove(event) {
    event.preventDefault();
    // 未確定の線の描画処理
    this.#draw(event.offsetX, event.offsetY);
  }

  /**
   * Canvas内ポインタUP処理
   * @param {PointerEvent} event
   */
  canvasPointerup(event) {
    event.preventDefault();
    // 未確定の線の確定描画処理
    this.#fixDraw();
    // 未確定の線の描画終了処理
    this.#endDrawing(event);
  }

  /**
   * Canvas内ポインタ離脱処理
   * @param {PointerEvent} event
   */
  canvasPointerleave(event) {
    // 未確定の線の描画終了処理
    this.#endDrawing(event);
  }

  /**
   * 未確定の線の描画終了処理
   * @param {PointerEvent} event
   */
  #endDrawing(event) {
    this.#drawingAC?.abort();
    this.#drawingAC = null;

    this.#addPointerdownListener();
    // Slight delay to avoid the context menu to appear (it can happen on a long
    // tap with a pen).
    if (this.#canvasContextMenuTimeoutId) {
      clearTimeout(this.#canvasContextMenuTimeoutId);
    }
    this.#canvasContextMenuTimeoutId = setTimeout(() => {
      this.#canvasContextMenuTimeoutId = null;
      this.canvas.removeEventListener("contextmenu", noContextMenu);
    }, 10);

    // 線の描画終了
    this.#stopDrawing(event.offsetX, event.offsetY);
    // 線のアノテーション情報を格納
    this.addToAnnotationStorage();
    // 線描画用Canvas（エディタ）を背後に回す
    this.setInBackground();
  }

  /**
   * 線アノテーション用Canvas生成
   */
  #createCanvas() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = 0;
    this.canvas.className = "lineEditorCanvas";
    this.canvas.setAttribute("data-l10n-id", "pdfjs-line-canvas");

    this.div.append(this.canvas);
    this.ctx = this.canvas.getContext("2d");
  }

  /**
   * 線アノテーションリサイズ監視制御生成
   */
  #createObserver() {
    this.#observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      if (rect.width && rect.height) {
        this.setDimensions(rect.width, rect.height);
      }
    });
    this.#observer.observe(this.div);
    this._uiManager._signal.addEventListener(
      "abort",
      () => {
        this.#observer?.disconnect();
        this.#observer = null;
      },
      { once: true }
    );
  }

  /**
   * アノテーションリサイズ可能チェック
   * @returns true:リサイズ可能 false:リサイズ不可能
   * @inheritdoc
   */
  get isResizable() {
    // アノテーションが生成済かつ、描画中以外の場合
    return !this.isEmpty() && this.#disableEditing;
  }

  /**
   * アノテーションレンダリング
   * @returns
   * @inheritdoc
   */
  render() {
    // DIVが存在している場合
    if (this.div) {
      // そのDIVを対象
      return this.div;
    }

    let baseX, baseY;
    if (this.width) {
      baseX = this.x;
      baseY = this.y;
    }

    super.render();

    this.div.setAttribute("data-l10n-id", "pdfjs-line");

    const [x, y, w, h] = this.#getInitialBBox();
    this.setAt(x, y, 0, 0);
    this.setDims(w, h);
    // 線アノテーション用Canvas生成
    this.#createCanvas();

    if (this.width) {
      // This editor was created in using copy (ctrl+c).
      const [parentWidth, parentHeight] = this.parentDimensions;
      this.setAspectRatio(this.width * parentWidth, this.height * parentHeight);
      this.setAt(
        baseX * parentWidth,
        baseY * parentHeight,
        this.width * parentWidth,
        this.height * parentHeight
      );
      this.#isCanvasInitialized = true;
      // Canvasサイズ設定
      this.#setCanvasDims();
      this.setDims(this.width * parentWidth, this.height * parentHeight);
      this.#redraw();
      // DIVのクラスにdisabledを追加
      this.div.classList.add("disabled");
    } else {
      // DIVのクラスにeditingを追加
      this.div.classList.add("editing");
      this.enableEditMode();
    }
    // 線アノテーションリサイズ監視制御生成
    this.#createObserver();

    return this.div;
  }

  /**
   * 線アノテーション用Canvasサイズ設定
   */
  #setCanvasDims() {
    // 線アノテーション用Canvasが未初期化の場合
    if (!this.#isCanvasInitialized) {
      // 何もしない
      return;
    }
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.canvas.width = Math.ceil(this.width * parentWidth);
    this.canvas.height = Math.ceil(this.height * parentHeight);
    this.#updateTransform();
  }

  /**
   * When the dimensions of the div change the inner canvas must
   * renew its dimensions, hence it must redraw its own contents.
   * @param {number} width - the new width of the div
   * @param {number} height - the new height of the div
   * @returns
   */
  setDimensions(width, height) {
    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);
    if (
      this.#realWidth === roundedWidth &&
      this.#realHeight === roundedHeight
    ) {
      return;
    }

    this.#realWidth = roundedWidth;
    this.#realHeight = roundedHeight;

    this.canvas.style.visibility = "hidden";

    const [parentWidth, parentHeight] = this.parentDimensions;
    this.width = width / parentWidth;
    this.height = height / parentHeight;
    this.fixAndSetPosition();

    if (this.#disableEditing) {
      this.#setScaleFactor(width, height);
    }

    this.#setCanvasDims();
    this.#redraw();

    this.canvas.style.visibility = "visible";

    // For any reason the dimensions couldn't be in percent but in pixels, hence
    // we must fix them.
    this.fixDims();
  }

  /**
   *
   * @param {number} width 幅
   * @param {number} height 高さ
   */
  #setScaleFactor(width, height) {
    const padding = this.#getPadding();
    const scaleFactorW = (width - padding) / this.#baseWidth;
    const scaleFactorH = (height - padding) / this.#baseHeight;
    this.scaleFactor = Math.min(scaleFactorW, scaleFactorH);
  }

  /**
   * Update the canvas transform.
   */
  #updateTransform() {
    const padding = this.#getPadding() / 2;
    this.ctx.setTransform(
      this.scaleFactor,
      0,
      0,
      this.scaleFactor,
      this.translationX * this.scaleFactor + padding,
      this.translationY * this.scaleFactor + padding
    );
  }

  /**
   * Convert into a Path2D.
   * @param {Array<Array<number>>} bezier
   * @returns {Path2D}
   */
  static #buildPath2D(bezier) {
    const path2D = new Path2D();
    for (let i = 0, ii = bezier.length; i < ii; i++) {
      const [first, control1, control2, second] = bezier[i];
      if (i === 0) {
        path2D.moveTo(...first);
      }
      path2D.bezierCurveTo(
        control1[0],
        control1[1],
        control2[0],
        control2[1],
        second[0],
        second[1]
      );
    }
    return path2D;
  }

  /**
   * PDFへ座標変換（座標→ポイント）
   * @param {*} points
   * @param {*} rect
   * @param {*} rotation
   * @returns
   */
  static #toPDFCoordinates(points, rect, rotation) {
    const [blX, blY, trX, trY] = rect;
    // 回転率判定
    switch (rotation) {
      case 0: // 0度の場合
        for (let i = 0, ii = points.length; i < ii; i += 2) {
          points[i] += blX;
          points[i + 1] = trY - points[i + 1];
        }
        break;
      case 90: // 90度の場合
        for (let i = 0, ii = points.length; i < ii; i += 2) {
          const x = points[i];
          points[i] = points[i + 1] + blX;
          points[i + 1] = x + blY;
        }
        break;
      case 180: // 180度の場合
        for (let i = 0, ii = points.length; i < ii; i += 2) {
          points[i] = trX - points[i];
          points[i + 1] += blY;
        }
        break;
      case 270: // 270度の場合
        for (let i = 0, ii = points.length; i < ii; i += 2) {
          const x = points[i];
          points[i] = trX - points[i + 1];
          points[i + 1] = trY - x;
        }
        break;
      default:
        throw new Error("Invalid rotation");
    }
    return points;
  }

  /**
   * PDFから座標変換（座標→ポイント）
   * @param {*} points
   * @param {*} rect
   * @param {*} rotation
   * @returns
   */
  static #fromPDFCoordinates(points, rect, rotation) {
    const [blX, blY, trX, trY] = rect;
    // 回転率判定
    switch (rotation) {
      case 0: // 0度の場合
        for (let i = 0, ii = points.length; i < ii; i += 2) {
          points[i] -= blX;
          points[i + 1] = trY - points[i + 1];
        }
        break;
      case 90: // 90度の場合
        for (let i = 0, ii = points.length; i < ii; i += 2) {
          const x = points[i];
          points[i] = points[i + 1] - blY;
          points[i + 1] = x - blX;
        }
        break;
      case 180: // 180度の場合
        for (let i = 0, ii = points.length; i < ii; i += 2) {
          points[i] = trX - points[i];
          points[i + 1] -= blY;
        }
        break;
      case 270: // 270度の場合
        for (let i = 0, ii = points.length; i < ii; i += 2) {
          const x = points[i];
          points[i] = trY - points[i + 1];
          points[i + 1] = trX - x;
        }
        break;
      default:
        throw new Error("Invalid rotation");
    }
    return points;
  }

  /**
   * 線アノテーションパスのシリアライズ（geometry情報生成）＆アノテーションパス登録
   * 線アノテーションのパス内情報をgeometryの配列に生成し、全体アノテーションパスに登録する
   * @param {number} s - scale factor
   * @param {number} tx - abscissa of the translation
   * @param {number} ty - ordinate of the translation
   * @param {Array<number>} rect - the bounding box of the annotation
   */
  #serializePaths(s, tx, ty, rect) {
    const paths = [];
    const padding = this.thickness / 2;
    const shiftX = s * tx + padding;
    const shiftY = s * ty + padding;
    for (const bezier of this.paths) {
      const buffer = [];
      const points = [];
      for (let j = 0, jj = bezier.length; j < jj; j++) {
        const [first, control1, control2, second] = bezier[j];
        if (first[0] === second[0] && first[1] === second[1] && jj === 1) {
          // We have only one point.
          const p0 = s * first[0] + shiftX;
          const p1 = s * first[1] + shiftY;
          buffer.push(p0, p1);
          points.push(p0, p1);
          break;
        }
        const p10 = s * first[0] + shiftX;
        const p11 = s * first[1] + shiftY;
        const p20 = s * control1[0] + shiftX;
        const p21 = s * control1[1] + shiftY;
        const p30 = s * control2[0] + shiftX;
        const p31 = s * control2[1] + shiftY;
        const p40 = s * second[0] + shiftX;
        const p41 = s * second[1] + shiftY;

        if (j === 0) {
          buffer.push(p10, p11);
          points.push(p10, p11);
        }
        buffer.push(p20, p21, p30, p31, p40, p41);
        points.push(p20, p21);
        if (j === jj - 1) {
          points.push(p40, p41);
        }
      }
      paths.push({
        bezier: LineEditor.#toPDFCoordinates(buffer, rect, this.rotation),
        points: LineEditor.#toPDFCoordinates(points, rect, this.rotation),
      });
    }

    return paths;
  }

  /**
   * Get the bounding box containing all the paths.
   * @returns {Array<number>}
   */
  #getBbox() {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;

    for (const path of this.paths) {
      for (const [first, control1, control2, second] of path) {
        const bbox = Util.bezierBoundingBox(
          ...first,
          ...control1,
          ...control2,
          ...second
        );
        xMin = Math.min(xMin, bbox[0]);
        yMin = Math.min(yMin, bbox[1]);
        xMax = Math.max(xMax, bbox[2]);
        yMax = Math.max(yMax, bbox[3]);
      }
    }

    return [xMin, yMin, xMax, yMax];
  }

  /**
   * The bounding box is computed with null thickness, so we must take
   * it into account for the display.
   * It corresponds to the total padding, hence it should be divided by 2
   * in order to have left/right paddings.
   * @returns {number}
   */
  #getPadding() {
    return this.#disableEditing
      ? Math.ceil(this.thickness * this.parentScale)
      : 0;
  }

  /**
   * DIVに内容設定
   * @returns {undefined}
   */
  #fitToContent(firstTime = false) {
    //
    if (this.isEmpty()) {
      return;
    }

    if (!this.#disableEditing) {
      this.#redraw();
      return;
    }

    const bbox = this.#getBbox();
    const padding = this.#getPadding();
    this.#baseWidth = Math.max(AnnotationEditor.MIN_SIZE, bbox[2] - bbox[0]);
    this.#baseHeight = Math.max(AnnotationEditor.MIN_SIZE, bbox[3] - bbox[1]);

    const width = Math.ceil(padding + this.#baseWidth * this.scaleFactor);
    const height = Math.ceil(padding + this.#baseHeight * this.scaleFactor);

    const [parentWidth, parentHeight] = this.parentDimensions;
    this.width = width / parentWidth;
    this.height = height / parentHeight;

    this.setAspectRatio(width, height);

    const prevTranslationX = this.translationX;
    const prevTranslationY = this.translationY;

    this.translationX = -bbox[0];
    this.translationY = -bbox[1];
    this.#setCanvasDims();
    this.#redraw();

    this.#realWidth = width;
    this.#realHeight = height;

    this.setDims(width, height);
    const unscaledPadding = firstTime ? padding / this.scaleFactor / 2 : 0;
    this.translate(
      prevTranslationX - this.translationX - unscaledPadding,
      prevTranslationY - this.translationY - unscaledPadding
    );
  }

  /**
   * 線アノテーションパスデシリアライズ
   * PDF情報から線アノテーションを取得し、線アノテーションパスにデシリアライズして登録
   * @param {Object} data デシリアライズ対象データ
   * @param {AnnotationEditorLayer} parent 親（アノテーションエディタレイヤ）
   * @param {AnnotationEditorUIManager} uiManager アノテーションエディタレイヤのUIマネージャ
   * @returns {Promise<AnnotationEditor | null>}
   * @inheritdoc
   */
  static async deserialize(data, parent, uiManager) {
    if (data instanceof LineAnnotationElement) {
      return null;
    }
    const editor = await super.deserialize(data, parent, uiManager);

    editor.thickness = data.thickness;
    editor.color = Util.makeHexColor(...data.color);
    editor.opacity = data.opacity;

    const [pageWidth, pageHeight] = editor.pageDimensions;
    const width = editor.width * pageWidth;
    const height = editor.height * pageHeight;
    const scaleFactor = editor.parentScale;
    const padding = data.thickness / 2;

    editor.#disableEditing = true;
    editor.#realWidth = Math.round(width);
    editor.#realHeight = Math.round(height);

    const { paths, rect, rotation } = data;

    for (let { bezier } of paths) {
      bezier = LineEditor.#fromPDFCoordinates(bezier, rect, rotation);
      const path = [];
      editor.paths.push(path);
      let p0 = scaleFactor * (bezier[0] - padding);
      let p1 = scaleFactor * (bezier[1] - padding);
      for (let i = 2, ii = bezier.length; i < ii; i += 6) {
        const p10 = scaleFactor * (bezier[i] - padding);
        const p11 = scaleFactor * (bezier[i + 1] - padding);
        const p20 = scaleFactor * (bezier[i + 2] - padding);
        const p21 = scaleFactor * (bezier[i + 3] - padding);
        const p30 = scaleFactor * (bezier[i + 4] - padding);
        const p31 = scaleFactor * (bezier[i + 5] - padding);
        path.push([
          [p0, p1],
          [p10, p11],
          [p20, p21],
          [p30, p31],
        ]);
        p0 = p30;
        p1 = p31;
      }
      const path2D = this.#buildPath2D(path);
      editor.bezierPath2D.push(path2D);
    }

    const bbox = editor.#getBbox();
    editor.#baseWidth = Math.max(AnnotationEditor.MIN_SIZE, bbox[2] - bbox[0]);
    editor.#baseHeight = Math.max(AnnotationEditor.MIN_SIZE, bbox[3] - bbox[1]);
    editor.#setScaleFactor(width, height);

    return editor;
  }

  /**
   * 線アノテーションパスシリアライズ
   * 線アノテーションパス情報をシリアライズして、返す
   * @returns {Object}
   * @inheritdoc
   */
  serialize() {
    if (this.isEmpty()) {
      return null;
    }

    const rect = this.getRect(0, 0);
    const color = AnnotationEditor._colorManager.convert(this.ctx.strokeStyle);

    return {
      annotationType: AnnotationEditorType.LINE,
      color,
      thickness: this.thickness,
      opacity: this.opacity,
      paths: this.#serializePaths(
        this.scaleFactor / this.parentScale,
        this.translationX,
        this.translationY,
        rect
      ),
      pageIndex: this.pageIndex,
      rect,
      rotation: this.rotation,
      structTreeParentId: this._structTreeParentId,
    };
  }
}

export { LineEditor };
