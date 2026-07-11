"""Convert pitch.html presentation to PDF with all slides visible."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

HTML_PATH = Path(__file__).parent / "pitch.html"
PDF_PATH = Path(__file__).parent / "pitch.pdf"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 720})

        await page.goto(HTML_PATH.as_uri())
        await page.wait_for_load_state("networkidle")

        # Inject CSS/JS to make all slides visible as separate print pages
        await page.evaluate("""() => {
            // Remove overflow hidden and fixed height so all slides stack
            const root = document.querySelector('.p-root');
            if (root) {
                root.style.height = 'auto';
                root.style.overflow = 'visible';
            }
            const main = document.querySelector('.p-main');
            if (main) {
                main.style.height = 'auto';
                main.style.padding = '0';
            }
            const frame = document.querySelector('.p-frame');
            if (frame) {
                frame.style.aspectRatio = 'unset';
                frame.style.maxWidth = '100%';
                frame.style.height = 'auto';
                frame.style.overflow = 'visible';
            }

            // Show all slides
            document.querySelectorAll('.p-slide').forEach(s => {
                s.style.display = 'flex';
                s.style.minHeight = '100vh';
                s.style.pageBreakAfter = 'always';
                s.style.breakAfter = 'page';
                s.style.animation = 'none';
                // Remove animation from children
                s.querySelectorAll('*').forEach(el => {
                    el.style.animation = 'none';
                    el.style.opacity = '1';
                    el.style.transform = 'none';
                });
            });

            // Hide navigation elements
            document.querySelector('.p-prog')?.style.setProperty('display', 'none');
            document.querySelector('.p-foot')?.style.setProperty('display', 'none');
            document.querySelector('.p-snum')?.style.setProperty('display', 'none');

            // Keep background orbs but make them static
            document.querySelectorAll('.p-orb').forEach(o => {
                o.style.animation = 'none';
            });
            document.querySelectorAll('.p-pt').forEach(pt => {
                pt.style.animation = 'none';
                pt.style.opacity = '0.3';
            });
        }""")

        await page.wait_for_timeout(500)

        await page.pdf(
            path=str(PDF_PATH),
            format="A4",
            landscape=True,
            print_background=True,
            margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
        )

        await browser.close()
        print(f"PDF saved: {PDF_PATH}")

asyncio.run(main())
