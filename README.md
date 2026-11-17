# PDF-dən test

A small website that turns a UNEC test-bank PDF into a practice test. Choose the PDF, type a question range (for example 1–50), answer the questions, and see the correct answers at the end. The PDF is read inside the browser and is never uploaded anywhere.

It works with PDFs where every question is numbered, the options are marked with •, and the correct option is marked with √. Formulas, schemes and graphs are cut from the PDF as pictures. Scanned PDFs (photos of pages, with no real text) cannot be read.

## Files

| File | What it is |
| --- | --- |
| `index.html` | the page |
| `style.css` | the design, light and dark |
| `app.js` | the test: range, questions, timer, results |
| `parser.js` | reads the questions, the • / √ marks and the pictures from the PDF |
| `pdfjs/` | Mozilla PDF.js 6.2.108, the PDF reader (Apache 2.0 licence, see `pdfjs/LICENSE`) |

## Publish it on GitHub Pages

1. Create a new **public** repository on GitHub.
2. Choose **Add file → Upload files** and drag in everything from this folder, including the `pdfjs` folder. Keep the file and folder names as they are, then commit.
3. Open **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick the branch **main** and the folder **/ (root)**, and save.
4. After a minute or two the site is live at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.

## Open it on your own computer

Double-clicking `index.html` also works while you are online: the browser then loads the same PDF.js version from jsDelivr instead of the `pdfjs` folder.

Unfinished tests and recent scores are saved in the browser you use, not on GitHub.
