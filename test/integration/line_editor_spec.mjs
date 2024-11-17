/*
 * R.Sato
 * LINE Editor Spec
 */

import {
  awaitPromise,
  closePages,
  createPromise,
  getEditorSelector,
  getRect,
  getSelectedEditors,
  kbRedo,
  kbSelectAll,
  kbUndo,
  loadAndWait,
  scrollIntoView,
  switchToEditor,
  waitForSerialized,
  waitForStorageEntries,
} from "./test_utils.mjs";

const waitForPointerUp = page =>
  createPromise(page, resolve => {
    window.addEventListener("pointerup", resolve, { once: true });
  });

const selectAll = async page => {
  await kbSelectAll(page);
  await page.waitForFunction(
    () => !document.querySelector(".lineEditor.disabled:not(.selectedEditor)")
  );
};

const clearAll = async page => {
  await selectAll(page);
  await page.keyboard.press("Backspace");
  await waitForStorageEntries(page, 0);
};

const commit = async page => {
  await page.keyboard.press("Escape");
  await page.waitForSelector(".lineEditor.selectedEditor.draggable.disabled");
};

const switchToLine = switchToEditor.bind(null, "Line");

describe("Line Editor", () => {
  describe("Basic operations", () => {
    let pages;

    beforeAll(async () => {
      pages = await loadAndWait("aboutstacks.pdf", ".annotationEditorLayer");
    });

    afterAll(async () => {
      await closePages(pages);
    });

    it("must draw, undo a deletion and check that the editors are not selected", async () => {
      await Promise.all(
        pages.map(async ([browserName, page]) => {
          await switchToLine(page);

          const rect = await getRect(page, ".annotationEditorLayer");

          for (let i = 0; i < 3; i++) {
            const x = rect.x + 100 + i * 100;
            const y = rect.y + 100 + i * 100;
            const clickHandle = await waitForPointerUp(page);
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(x + 50, y + 50);
            await page.mouse.up();
            await awaitPromise(clickHandle);

            await commit(page);
          }

          await clearAll(page);

          await kbUndo(page);
          await waitForStorageEntries(page, 3);

          expect(await getSelectedEditors(page))
            .withContext(`In ${browserName}`)
            .toEqual([]);
        })
      );
    });

    it("must draw, undo/redo and check that the editor don't move", async () => {
      await Promise.all(
        pages.map(async ([browserName, page]) => {
          await clearAll(page);

          const rect = await getRect(page, ".annotationEditorLayer");

          const xStart = rect.x + 300;
          const yStart = rect.y + 300;
          const clickHandle = await waitForPointerUp(page);
          await page.mouse.move(xStart, yStart);
          await page.mouse.down();
          await page.mouse.move(xStart + 50, yStart + 50);
          await page.mouse.up();
          await awaitPromise(clickHandle);

          await commit(page);

          const rectBefore = await getRect(page, ".lineEditor canvas");

          for (let i = 0; i < 30; i++) {
            await kbUndo(page);
            await waitForStorageEntries(page, 0);
            await kbRedo(page);
            await waitForStorageEntries(page, 1);
          }

          const rectAfter = await getRect(page, ".lineEditor canvas");

          expect(Math.round(rectBefore.x))
            .withContext(`In ${browserName}`)
            .toEqual(Math.round(rectAfter.x));

          expect(Math.round(rectBefore.y))
            .withContext(`In ${browserName}`)
            .toEqual(Math.round(rectAfter.y));
        })
      );
    });
  });

  describe("with a rotated pdf", () => {
    let pages;

    beforeAll(async () => {
      pages = await loadAndWait("issue16278.pdf", ".annotationEditorLayer");
    });

    afterAll(async () => {
      await closePages(pages);
    });

    it("must draw something", async () => {
      await Promise.all(
        pages.map(async ([browserName, page]) => {
          await switchToLine(page);

          const rect = await getRect(page, ".annotationEditorLayer");

          const x = rect.x + 20;
          const y = rect.y + 20;
          const clickHandle = await waitForPointerUp(page);
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x + 50, y + 50);
          await page.mouse.up();
          await awaitPromise(clickHandle);

          await commit(page);

          await selectAll(page);

          expect(await getSelectedEditors(page))
            .withContext(`In ${browserName}`)
            .toEqual([0]);
        })
      );
    });
  });

  describe("Invisible layers must be disabled", () => {
    let pages;

    beforeAll(async () => {
      pages = await loadAndWait("tracemonkey.pdf", ".annotationEditorLayer");
    });

    afterAll(async () => {
      await closePages(pages);
    });

    it("must check that the editor layer is disabled", async () => {
      await Promise.all(
        pages.map(async ([browserName, page]) => {
          await switchToLine(page);

          const rect = await getRect(page, ".annotationEditorLayer");

          const x = rect.x + 20;
          const y = rect.y + 20;
          const clickHandle = await waitForPointerUp(page);
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x + 50, y + 50);
          await page.mouse.up();
          await awaitPromise(clickHandle);

          await commit(page);

          const oneToFourteen = Array.from(new Array(13).keys(), n => n + 2);
          for (const pageNumber of oneToFourteen) {
            await scrollIntoView(
              page,
              `.page[data-page-number = "${pageNumber}"]`
            );
          }

          await switchToLine(page, /* disable */ true);

          const fourteenToOne = Array.from(new Array(13).keys(), n => 13 - n);
          for (const pageNumber of fourteenToOne) {
            await scrollIntoView(
              page,
              `.page[data-page-number = "${pageNumber}"]`
            );
          }

          await page.waitForSelector(
            `.page[data-page-number = "1"] .annotationEditorLayer.disabled:not(.lineEditing)`
          );
        })
      );
    });
  });

  describe("Line editor must be committed when blurred", () => {
    let pages;

    beforeAll(async () => {
      pages = await loadAndWait("tracemonkey.pdf", ".annotationEditorLayer");
    });

    afterAll(async () => {
      await closePages(pages);
    });

    it("must check that the line editor is committed", async () => {
      await Promise.all(
        pages.map(async ([browserName, page]) => {
          await switchToLine(page);

          const rect = await getRect(page, ".annotationEditorLayer");

          const x = rect.x + 20;
          const y = rect.y + 20;
          const clickHandle = await waitForPointerUp(page);
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x + 50, y + 50);
          await page.mouse.up();
          await awaitPromise(clickHandle);

          page.mouse.click(rect.x - 10, rect.y + 10);
          await page.waitForSelector(`${getEditorSelector(0)}.disabled`);
        })
      );
    });
  });

  describe("Undo a draw", () => {
    let pages;

    beforeAll(async () => {
      pages = await loadAndWait("tracemonkey.pdf", ".annotationEditorLayer");
    });

    afterAll(async () => {
      await closePages(pages);
    });

    it("must check that a draw can be undone", async () => {
      await Promise.all(
        pages.map(async ([browserName, page]) => {
          await switchToLine(page);

          const rect = await getRect(page, ".annotationEditorLayer");

          const xStart = rect.x + 300;
          const yStart = rect.y + 300;
          const clickHandle = await waitForPointerUp(page);
          await page.mouse.move(xStart, yStart);
          await page.mouse.down();
          await page.mouse.move(xStart + 50, yStart + 50);
          await page.mouse.up();
          await awaitPromise(clickHandle);
          await commit(page);

          await page.waitForSelector(getEditorSelector(0));
          await waitForSerialized(page, 1);

          await page.waitForSelector(`${getEditorSelector(0)} button.delete`);
          await page.click(`${getEditorSelector(0)} button.delete`);
          await waitForSerialized(page, 0);

          await kbUndo(page);
          await waitForSerialized(page, 1);
          await page.waitForSelector(getEditorSelector(0));
        })
      );
    });
  });

  describe("Delete a draw and undo it on another page", () => {
    let pages;

    beforeAll(async () => {
      pages = await loadAndWait("tracemonkey.pdf", ".annotationEditorLayer");
    });

    afterAll(async () => {
      await closePages(pages);
    });

    it("must check that a draw can be undone", async () => {
      await Promise.all(
        pages.map(async ([browserName, page]) => {
          await switchToLine(page);

          const rect = await getRect(page, ".annotationEditorLayer");

          const xStart = rect.x + 300;
          const yStart = rect.y + 300;
          const clickHandle = await waitForPointerUp(page);
          await page.mouse.move(xStart, yStart);
          await page.mouse.down();
          await page.mouse.move(xStart + 50, yStart + 50);
          await page.mouse.up();
          await awaitPromise(clickHandle);
          await commit(page);

          await page.waitForSelector(getEditorSelector(0));
          await waitForSerialized(page, 1);

          await page.waitForSelector(`${getEditorSelector(0)} button.delete`);
          await page.click(`${getEditorSelector(0)} button.delete`);
          await waitForSerialized(page, 0);

          const twoToFourteen = Array.from(new Array(13).keys(), n => n + 2);
          for (const pageNumber of twoToFourteen) {
            const pageSelector = `.page[data-page-number = "${pageNumber}"]`;
            await scrollIntoView(page, pageSelector);
          }

          await kbUndo(page);
          await waitForSerialized(page, 1);

          const thirteenToOne = Array.from(new Array(13).keys(), n => 13 - n);
          for (const pageNumber of thirteenToOne) {
            const pageSelector = `.page[data-page-number = "${pageNumber}"]`;
            await scrollIntoView(page, pageSelector);
          }

          await page.waitForSelector(getEditorSelector(0));
        })
      );
    });
  });

  describe("Delete a draw, scroll and undo it", () => {
    let pages;

    beforeAll(async () => {
      pages = await loadAndWait("tracemonkey.pdf", ".annotationEditorLayer");
    });

    afterAll(async () => {
      await closePages(pages);
    });

    it("must check that a draw can be undone", async () => {
      await Promise.all(
        pages.map(async ([browserName, page]) => {
          await switchToLine(page);

          const rect = await getRect(page, ".annotationEditorLayer");

          const xStart = rect.x + 300;
          const yStart = rect.y + 300;
          const clickHandle = await waitForPointerUp(page);
          await page.mouse.move(xStart, yStart);
          await page.mouse.down();
          await page.mouse.move(xStart + 50, yStart + 50);
          await page.mouse.up();
          await awaitPromise(clickHandle);
          await commit(page);

          await page.waitForSelector(getEditorSelector(0));
          await waitForSerialized(page, 1);

          await page.waitForSelector(`${getEditorSelector(0)} button.delete`);
          await page.click(`${getEditorSelector(0)} button.delete`);
          await waitForSerialized(page, 0);

          const twoToOne = Array.from(new Array(13).keys(), n => n + 2).concat(
            Array.from(new Array(13).keys(), n => 13 - n)
          );
          for (const pageNumber of twoToOne) {
            const pageSelector = `.page[data-page-number = "${pageNumber}"]`;
            await scrollIntoView(page, pageSelector);
          }

          await kbUndo(page);
          await waitForSerialized(page, 1);
          await page.waitForSelector(getEditorSelector(0));
        })
      );
    });
  });

  describe("Draw several times in the same editor", () => {
    let pages;

    beforeAll(async () => {
      pages = await loadAndWait("empty.pdf", ".annotationEditorLayer");
    });

    afterAll(async () => {
      await closePages(pages);
    });

    it("must check that we can draw several times on the same canvas", async () => {
      await Promise.all(
        pages.map(async ([browserName, page]) => {
          await switchToLine(page);
          const rect = await getRect(page, ".annotationEditorLayer");

          let xStart = rect.x + 10;
          const yStart = rect.y + 10;
          for (let i = 0; i < 5; i++) {
            const clickHandle = await waitForPointerUp(page);
            await page.mouse.move(xStart, yStart);
            await page.mouse.down();
            await page.mouse.move(xStart + 50, yStart + 50);
            await page.mouse.up();
            await awaitPromise(clickHandle);
            xStart += 70;
          }
          await commit(page);

          await page.waitForSelector(getEditorSelector(0));
        })
      );
    });
  });
});
