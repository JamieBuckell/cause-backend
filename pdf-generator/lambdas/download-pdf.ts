import puppeteer from "puppeteer-serverless";
import QRCode from "qrcode";

const pdfTemplates = {
  labels: `
    <div style="display: grid; grid-template-columns: 1fr 1fr; grid-gap: 20px; margin:0 auto 10px; font-size:3rem; width:85%; page-break-after: always;">
      <div style="border: dashed 4px black; width:85%; padding:0 20px;">
        <p style="margin: 0.5em 0;"><strong>ID:</strong> ###HAMPER_ID###</p>

        <p style="margin: 0.5em 0; font-size:0.75rem; text-align: center;">
          <img src="###QR_CODE###" style="margin:0 auto;width:100%; max-width:200px; display:block;" />
          <br />
          <strong>Dynamics</strong>
          <br />
          ###FAMILY_DYNAMICS###
        </p>

        <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
          <p style="margin: 0.5em 0;">
            <strong>1 of</strong> <span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span>
          </p>
        </div>
      </div>
        
      <div style="border: dashed 4px black; width:85%; padding:0 20px;">
        <p style="margin: 0.5em 0;"><strong>ID:</strong> ###HAMPER_ID###</p>

        <p style="margin: 0.5em 0; font-size:0.75rem; text-align: center;">
          <img src="###QR_CODE###" style="margin:0 auto;width:100%; max-width:200px; display:block;" />
          <br />
          <strong>Dynamics</strong>
          <br />
          ###FAMILY_DYNAMICS###
        </p>

        <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
          <p style="margin: 0.5em 0;">
            <strong>2 of</strong> <span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span>
          </p>
        </div>
      </div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; grid-gap: 20px; margin:0 auto 10px; font-size:3rem; width:85%;">
      <div style="border: dashed 4px black; width:85%; padding:0 20px;">
        <p style="margin: 0.5em 0;"><strong>ID:</strong> ###HAMPER_ID###</p>

        <p style="margin: 0.5em 0; font-size:0.75rem; text-align: center;">
          <img src="###QR_CODE###" style="margin:0 auto;width:100%; max-width:200px; display:block;" />
          <br />
          <strong>Dynamics</strong>
          <br />
          ###FAMILY_DYNAMICS###
        </p>

        <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
          <p style="margin: 0.5em 0;">
            <strong>3 of</strong> <span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span>
          </p>
        </div>
      </div>
      <div style="border: dashed 4px black; width:85%; padding:0 20px;">
        <p style="margin: 0.5em 0;"><strong>ID:</strong> ###HAMPER_ID###</p>

        <p style="margin: 0.5em 0; font-size:0.75rem; text-align: center;">
          <img src="###QR_CODE###" style="margin:0 auto;width:100%; max-width:200px; display:block;" />
          <br />
          <strong>Dynamics</strong>
          <br />
          ###FAMILY_DYNAMICS###
        </p>

        <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
          <p style="margin: 0.5em 0;">
            <strong>4 of</strong> <span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span>
          </p>
        </div>
      </div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; grid-gap: 20px; margin:0 auto 10px; font-size:3rem; width:85%; page-break-after: always;">
      <div style="border: dashed 4px black; width:85%; padding:0 20px;">
        <p style="margin: 0.5em 0;"><strong>ID:</strong> ###HAMPER_ID###</p>

        <p style="margin: 0.5em 0; font-size:0.75rem; text-align: center;">
          <img src="###QR_CODE###" style="margin:0 auto;width:100%; max-width:200px; display:block;" />
          <br />
          <strong>Dynamics</strong>
          <br />
          ###FAMILY_DYNAMICS###
        </p>

        <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
          <p style="margin: 0.5em 0;">
            <strong>5 of</strong> <span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span>
          </p>
        </div>
      </div>
      <div style="border: dashed 4px black; width:85%; padding:0 20px;">
        <p style="margin: 0.5em 0;"><strong>ID:</strong> ###HAMPER_ID###</p>

        <p style="margin: 0.5em 0; font-size:0.75rem; text-align: center;">
          <img src="###QR_CODE###" style="margin:0 auto;width:100%; max-width:200px; display:block;" />
          <br />
          <strong>Dynamics</strong>
          <br />
          ###FAMILY_DYNAMICS###
        </p>

        <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
          <p style="margin: 0.5em 0;">
            <strong>6 of</strong> <span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span>
          </p>
        </div>
      </div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; grid-gap: 20px; margin:0 auto 10px; font-size:3rem; width:85%;">
      <div style="border: dashed 4px black; width:85%; padding:0 20px;">
        <p style="margin: 0.5em 0;"><strong>ID:</strong> ###HAMPER_ID###</p>

        <p style="margin: 0.5em 0; font-size:0.75rem; text-align: center;">
          <img src="###QR_CODE###" style="margin:0 auto;width:100%; max-width:200px; display:block;" />
          <br />
          <strong>Dynamics</strong>
          <br />
          ###FAMILY_DYNAMICS###
        </p>

        <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
          <p style="margin: 0.5em 0;">
            <strong><span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span> of</strong> <span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span>
          </p>
        </div>
      </div>
      <div style="border: dashed 4px black; width:85%; padding:0 20px;">
        <p style="margin: 0.5em 0;"><strong>ID:</strong> ###HAMPER_ID###</p>

        <p style="margin: 0.5em 0; font-size:0.75rem; text-align: center;">
          <img src="###QR_CODE###" style="margin:0 auto;width:100%; max-width:200px; display:block;" />
          <br />
          <strong>Dynamics</strong>
          <br />
          ###FAMILY_DYNAMICS###
        </p>

        <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
          <p style="margin: 0.5em 0;">
            <strong><span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span> of</strong> <span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span>
          </p>
        </div>
      </div>
    </div><div style="display: grid; grid-template-columns: 1fr 1fr; grid-gap: 20px; margin:0 auto 10px; font-size:3rem; width:85%;">
      <div style="border: dashed 4px black; width:85%; padding:0 20px;">
        <p style="margin: 0.5em 0;"><strong>ID:</strong> ###HAMPER_ID###</p>

        <p style="margin: 0.5em 0; font-size:0.75rem; text-align: center;">
          <img src="###QR_CODE###" style="margin:0 auto;width:100%; max-width:200px; display:block;" />
          <br />
          <strong>Dynamics</strong>
          <br />
          ###FAMILY_DYNAMICS###
        </p>

        <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
          <p style="margin: 0.5em 0;">
            <strong><span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span> of</strong> <span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span>
          </p>
        </div>
      </div>
      <div style="border: dashed 4px black; width:85%; padding:0 20px;">
        <p style="margin: 0.5em 0;"><strong>ID:</strong> ###HAMPER_ID###</p>

        <p style="margin: 0.5em 0; font-size:0.75rem; text-align: center;">
          <img src="###QR_CODE###" style="margin:0 auto;width:100%; max-width:200px; display:block;" />
          <br />
          <strong>Dynamics</strong>
          <br />
          ###FAMILY_DYNAMICS###
        </p>

        <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
          <p style="margin: 0.5em 0;">
            <strong><span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span> of</strong> <span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span>
          </p>
        </div>
      </div>
    </div><div style="display: grid; grid-template-columns: 1fr 1fr; grid-gap: 20px; margin:0 auto 10px; font-size:3rem; width:85%;">
      <div style="border: dashed 4px black; width:85%; padding:0 20px;">
        <p style="margin: 0.5em 0;"><strong>ID:</strong> ###HAMPER_ID###</p>

        <p style="margin: 0.5em 0; font-size:0.75rem; text-align: center;">
          <img src="###QR_CODE###" style="margin:0 auto;width:100%; max-width:200px; display:block;" />
          <br />
          <strong>Dynamics</strong>
          <br />
          ###FAMILY_DYNAMICS###
        </p>

        <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
          <p style="margin: 0.5em 0;">
            <strong><span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span> of</strong> <span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span>
          </p>
        </div>
      </div>
      <div style="border: dashed 4px black; width:85%; padding:0 20px;">
        <p style="margin: 0.5em 0;"><strong>ID:</strong> ###HAMPER_ID###</p>

        <p style="margin: 0.5em 0; font-size:0.75rem; text-align: center;">
          <img src="###QR_CODE###" style="margin:0 auto;width:100%; max-width:200px; display:block;" />
          <br />
          <strong>Dynamics</strong>
          <br />
          ###FAMILY_DYNAMICS###
        </p>

        <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
          <p style="margin: 0.5em 0;">
            <strong><span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span> of</strong> <span style="font-size:1.5rem; letter-spacing: 0.5rem;">...</span>
          </p>
        </div>
      </div>
    </div>
   `,
  labelsBasic: `
    <div style="display: grid; grid-template-columns: 1fr 1fr; grid-gap: 20px; margin:0 auto 10px; font-size:3rem; width:85%; page-break-after: always;">
                
        <div style="border: dashed 4px black; width:85%; padding:0 20px;">
            <p style="margin: 0.5em 0; font-size:0.6em;"><strong>ID:</strong> ###HAMPER_ID###</p>
            <p style="margin: 0.5em 0; font-size:0.3em;"><strong>Family Dynamics:</strong> ###FAMILY_DYNAMICS###</p>

            <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
              <p style="margin: 0.5em 0; font-size:0.6em;">
                  <span style="letter-spacing: 0.5rem;">...</span> <strong>of</strong> <span style="letter-spacing: 0.5rem;">...</span>
              </p>
            </div>
        </div>
        
        <div style="border: dashed 4px black; width:85%; padding:0 20px;">
            <p style="margin: 0.5em 0; font-size:0.6em;"><strong>ID:</strong> ###HAMPER_ID###</p>
            <p style="margin: 0.5em 0; font-size:0.3em;"><strong>Family Dynamics:</strong> ###FAMILY_DYNAMICS###</p>

            <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
              <p style="margin: 0.5em 0; font-size:0.6em;">
                  <span style="letter-spacing: 0.5rem;">...</span> <strong>of</strong> <span style="letter-spacing: 0.5rem;">...</span>
              </p>
            </div>
        </div>
        
        <div style="border: dashed 4px black; width:85%; padding:0 20px;">
            <p style="margin: 0.5em 0; font-size:0.6em;"><strong>ID:</strong> ###HAMPER_ID###</p>
            <p style="margin: 0.5em 0; font-size:0.3em;"><strong>Family Dynamics:</strong> ###FAMILY_DYNAMICS###</p>

            <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
              <p style="margin: 0.5em 0; font-size:0.6em;">
                  <span style="letter-spacing: 0.5rem;">...</span> <strong>of</strong> <span style="letter-spacing: 0.5rem;">...</span>
              </p>
            </div>
        </div>
        
        <div style="border: dashed 4px black; width:85%; padding:0 20px;">
            <p style="margin: 0.5em 0; font-size:0.6em;"><strong>ID:</strong> ###HAMPER_ID###</p>
            <p style="margin: 0.5em 0; font-size:0.3em;"><strong>Family Dynamics:</strong> ###FAMILY_DYNAMICS###</p>

            <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
              <p style="margin: 0.5em 0; font-size:0.6em;">
                  <span style="letter-spacing: 0.5rem;">...</span> <strong>of</strong> <span style="letter-spacing: 0.5rem;">...</span>
              </p>
            </div>
        </div>
        
        <div style="border: dashed 4px black; width:85%; padding:0 20px;">
            <p style="margin: 0.5em 0; font-size:0.6em;"><strong>ID:</strong> ###HAMPER_ID###</p>
            <p style="margin: 0.5em 0; font-size:0.3em;"><strong>Family Dynamics:</strong> ###FAMILY_DYNAMICS###</p>

            <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
              <p style="margin: 0.5em 0; font-size:0.6em;">
                  <span style="letter-spacing: 0.5rem;">...</span> <strong>of</strong> <span style="letter-spacing: 0.5rem;">...</span>
              </p>
            </div>
        </div>
        
        <div style="border: dashed 4px black; width:85%; padding:0 20px;">
            <p style="margin: 0.5em 0; font-size:0.6em;"><strong>ID:</strong> ###HAMPER_ID###</p>
            <p style="margin: 0.5em 0; font-size:0.3em;"><strong>Family Dynamics:</strong> ###FAMILY_DYNAMICS###</p>

            <div style="display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; width:100%;">
              <p style="margin: 0.5em 0; font-size:0.6em;">
                  <span style="letter-spacing: 0.5rem;">...</span> <strong>of</strong> <span style="letter-spacing: 0.5rem;">...</span>
              </p>
            </div>
        </div>
    </div>`,
  feedbackSlip: `
    <div style="width:50%; float:left; padding:0 20px 80px; box-sizing: border-box; text-align:center;">
      <p style="font-size:0.7rem; margin:0;">
        This hamper was provided by the kind and generous supporters of
      </p>
      <img src="https://portal.cause-foundation.org.uk/static/img/cause-foundation-logo.png" height="50px" style="margin:0 auto; padding: 0;">
      <div style="margin: 0.5em 0; text-align:left;">
        <div style="float:left;width:120px">
          <img src="###QR_CODE###" style=" max-width:100px;">
            <br>
          <span style="font-size:0.7rem;">###HAMPER_ID###</span> 
        </div>
        <div>If you would like to leave us anonymous feedback about your hamper, please scan the QR code with your phone.</div>
      </div>
      
      <div style="width: 100%; margin:0;">
        <img src="https://thyngs.net/wp-content/uploads/2021/02/QR-Instructions-1-1.jpg" style="max-width:100%; margin: 0;" />
        www.cause-foundation.org.uk
        <span style="display:block; font-size:0.7rem;">Registered as a Charity with the Charity Commission: 1195836</span>
      </div>
    </div>`,
  pageBreak: `<div style="page-break-after: always;"></div>`,
};

export const main = async (event: any, context: any): Promise<any> => {
  let browser = null;
  let pdf = null;

  const parsed = event.pdfPages ? event : JSON.parse(event.body);

  try {
    if (parsed.pdfPages) {
      browser = await puppeteer.launch({});
      const page = await browser.newPage();

      let docContent = `<!DOCTYPE html><html><body style="font-family: Verdana, sans-serif;">`;

      for (const [key, p] of parsed.pdfPages.entries()) {
        console.log(p);
        if (p.template) {
          let pageContent = pdfTemplates[p.template];
          console.log(p.template, pdfTemplates, pageContent);
          if (p.qrCode) {
            console.log("QR Code");
            const qrCode = await QRCode.toDataURL(p.qrCode);
            pageContent = pageContent.replace(/###QR_CODE###/g, qrCode);
          }
          if (p.replaceStrings) {
            console.log("replaceStrings");
            for (const [find, replace] of Object.entries(p.replaceStrings)) {
              console.log(find, replace);
              const re = new RegExp(find, "g");
              pageContent = pageContent.replace(re, replace);
            }
          }
          docContent += pageContent;
        }
      }
      docContent += `</body></html>`;
      console.log(docContent);
      await page.setContent(docContent, {
        waitUntil: "load",
      });

      pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        landscape: !parsed?.version,
        margin: {
          top: 40,
          right: 0,
          bottom: 40,
          left: 0,
        },
        headerTemplate: `
            <div style="width: 100%; font-size: 11px;
                  padding: 5px 5px 0; color: gray; position: relative;">
            </div>`,
        footerTemplate: `
            <div style="width: 100%; font-size: 11px;
                padding: 5px 5px 0; color: gray; position: relative;">
                <div style="position: absolute; right: 20px; top: 2px;">
                  <span class="pageNumber"></span>/<span class="totalPages"></span>
                </div>
            </div>
          `,
      });
    }
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }

  context.succeed(pdf.toString("base64"));
};
