import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { APIGatewayProxyHandler } from "aws-lambda";
import { generatePdfBuffer } from "./generatePdfBuffer";
import QRCode from "qrcode";

const s3Client = new S3Client({ region: process.env.AWS_REGION });

const pdfTemplates: any = {
  labels: `
  <div class="page landscape">
    <div class="middle label-grid">
          <div class="label">
              <p class="id"><strong>ID:</strong> ###HAMPER_ID###</p>

              <p class="code">
                  <img src="###QR_CODE###" />
                  <strong>Dynamics</strong>
                  <br />
                  ###FAMILY_DYNAMICS###
              </p>

              <div class="label-footer">
                  <p>
                      <strong>1 of </strong> <span class="ellipsis">...</span>
                  </p>
              </div>
          </div>
          <div class="label">
              <p class="id"><strong>ID:</strong> ###HAMPER_ID###</p>

              <p class="code">
                  <img src="###QR_CODE###" />
                  <strong>Dynamics</strong>
                  <br />
                  ###FAMILY_DYNAMICS###
              </p>

              <div class="label-footer">
                  <p>
                      <strong>2 of </strong> <span class="ellipsis">...</span>
                  </p>
              </div>
          </div>
          <div class="label">
              <p class="id"><strong>ID:</strong> ###HAMPER_ID###</p>

              <p class="code">
                  <img src="###QR_CODE###" />
                  <strong>Dynamics</strong>
                  <br />
                  ###FAMILY_DYNAMICS###
              </p>

              <div class="label-footer">
                  <p>
                      <strong>3 of </strong> <span class="ellipsis">...</span>
                  </p>
              </div>
          </div>

          <div class="label">
              <p class="id"><strong>ID:</strong> ###HAMPER_ID###</p>

              <p class="code">
                  <img src="###QR_CODE###" />
                  <strong>Dynamics</strong>
                  <br />
                  ###FAMILY_DYNAMICS###
              </p>

              <div class="label-footer">
                  <p>
                      <strong>4 of </strong> <span class="ellipsis">...</span>
                  </p>
              </div>
          </div>
          <div class="label">
              <p class="id"><strong>ID:</strong> ###HAMPER_ID###</p>

              <p class="code">
                  <img src="###QR_CODE###" />
                  <strong>Dynamics</strong>
                  <br />
                  ###FAMILY_DYNAMICS###
              </p>

              <div class="label-footer">
                  <p>
                      <strong>5 of </strong> <span class="ellipsis">...</span>
                  </p>
              </div>
          </div>
          <div class="label">
              <p class="id"><strong>ID:</strong> ###HAMPER_ID###</p>

              <p class="code">
                  <img src="###QR_CODE###" />
                  <strong>Dynamics</strong>
                  <br />
                  ###FAMILY_DYNAMICS###
              </p>

              <div class="label-footer">
                  <p>
                      <strong>6 of </strong> <span class="ellipsis">...</span>
                  </p>
              </div>
          </div>
      </div>
    </div>
    <div class="page landscape">
      <div class="middle label-grid">
          <div class="label">
              <p class="id"><strong>ID:</strong> ###HAMPER_ID###</p>

              <p class="code">
                  <img src="###QR_CODE###" />
                  <strong>Dynamics</strong>
                  <br />
                  ###FAMILY_DYNAMICS###
              </p>

              <div class="label-footer">
                  <p>
                      <span class="ellipsis">...</span><strong> of </strong> <span
                          class="ellipsis">...</span>
                  </p>
              </div>
          </div>
          <div class="label">
              <p class="id"><strong>ID:</strong> ###HAMPER_ID###</p>

              <p class="code">
                  <img src="###QR_CODE###" />
                  <strong>Dynamics</strong>
                  <br />
                  ###FAMILY_DYNAMICS###
              </p>

              <div class="label-footer">
                  <p>
                      <span class="ellipsis">...</span><strong> of </strong> <span
                          class="ellipsis">...</span>
                  </p>
              </div>
          </div>
          <div class="label">
              <p class="id"><strong>ID:</strong> ###HAMPER_ID###</p>

              <p class="code">
                  <img src="###QR_CODE###" />
                  <strong>Dynamics</strong>
                  <br />
                  ###FAMILY_DYNAMICS###
              </p>

              <div class="label-footer">
                  <p>
                      <span class="ellipsis">...</span><strong> of </strong> <span
                          class="ellipsis">...</span>
                  </p>
              </div>
          </div>

          <div class="label">
              <p class="id"><strong>ID:</strong> ###HAMPER_ID###</p>

              <p class="code">
                  <img src="###QR_CODE###" />
                  <strong>Dynamics</strong>
                  <br />
                  ###FAMILY_DYNAMICS###
              </p>

              <div class="label-footer">
                  <p>
                      <span class="ellipsis">...</span><strong> of </strong> <span
                          class="ellipsis">...</span>
                  </p>
              </div>
          </div>
          <div class="label">
              <p class="id"><strong>ID:</strong> ###HAMPER_ID###</p>

              <p class="code">
                  <img src="###QR_CODE###" />
                  <strong>Dynamics</strong>
                  <br />
                  ###FAMILY_DYNAMICS###
              </p>

              <div class="label-footer">
                  <p>
                      <span class="ellipsis">...</span><strong> of </strong> <span
                          class="ellipsis">...</span>
                  </p>
              </div>
          </div>
          <div class="label">
              <p class="id"><strong>ID:</strong> ###HAMPER_ID###</p>

              <p class="code">
                  <img src="###QR_CODE###" />
                  <strong>Dynamics</strong>
                  <br />
                  ###FAMILY_DYNAMICS###
              </p>

              <div class="label-footer">
                  <p>
                      <span class="ellipsis">...</span><strong> of </strong> <span
                          class="ellipsis">...</span>
                  </p>
              </div>
          </div>
      </div>
    </div>`,
  labelsBasic: `
    <div style="display: grid; grid-template-columns: 1fr 1fr; grid-gap: 20px; margin: 10px auto; font-size: 2rem; width:85%; page-break-after: always;">
                
        <div class="label">
            <p style="font-size:0.6em;"><strong>ID:</strong> ###HAMPER_ID###</p>
            <p style="font-size:0.3em;"><strong>Family Dynamics:</strong> ###FAMILY_DYNAMICS###</p>

            <div class="label-footer">
              <p style="font-size:0.6em;">
                  <span style="letter-spacing: 0.5rem;">...</span> <strong>of</strong> <span style="letter-spacing: 0.5rem;">...</span>
              </p>
            </div>
        </div>
        
        <div class="label">
            <p style="font-size:0.6em;"><strong>ID:</strong> ###HAMPER_ID###</p>
            <p style="font-size:0.3em;"><strong>Family Dynamics:</strong> ###FAMILY_DYNAMICS###</p>

            <div class="label-footer">
              <p style="font-size:0.6em;">
                  <span style="letter-spacing: 0.5rem;">...</span> <strong>of</strong> <span style="letter-spacing: 0.5rem;">...</span>
              </p>
            </div>
        </div>
        
        <div class="label">
            <p style="font-size:0.6em;"><strong>ID:</strong> ###HAMPER_ID###</p>
            <p style="font-size:0.3em;"><strong>Family Dynamics:</strong> ###FAMILY_DYNAMICS###</p>

            <div class="label-footer">
              <p style="font-size:0.6em;">
                  <span style="letter-spacing: 0.5rem;">...</span> <strong>of</strong> <span style="letter-spacing: 0.5rem;">...</span>
              </p>
            </div>
        </div>
        
        <div class="label">
            <p style="font-size:0.6em;"><strong>ID:</strong> ###HAMPER_ID###</p>
            <p style="font-size:0.3em;"><strong>Family Dynamics:</strong> ###FAMILY_DYNAMICS###</p>

            <div class="label-footer">
              <p style="font-size:0.6em;">
                  <span style="letter-spacing: 0.5rem;">...</span> <strong>of</strong> <span style="letter-spacing: 0.5rem;">...</span>
              </p>
            </div>
        </div>
        
        <div class="label">
            <p style="font-size:0.6em;"><strong>ID:</strong> ###HAMPER_ID###</p>
            <p style="font-size:0.3em;"><strong>Family Dynamics:</strong> ###FAMILY_DYNAMICS###</p>

            <div class="label-footer">
              <p style="font-size:0.6em;">
                  <span style="letter-spacing: 0.5rem;">...</span> <strong>of</strong> <span style="letter-spacing: 0.5rem;">...</span>
              </p>
            </div>
        </div>
        
        <div class="label">
            <p style="font-size:0.6em;"><strong>ID:</strong> ###HAMPER_ID###</p>
            <p style="font-size:0.3em;"><strong>Family Dynamics:</strong> ###FAMILY_DYNAMICS###</p>

            <div class="label-footer">
              <p style="font-size:0.6em;">
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
      <div style="text-align:left;">
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

export const handler: APIGatewayProxyHandler = async (event: any) => {
  try {
    console.log(event);
    if (!event.body) {
      return {
        statusCode: 400,
        body: "Invalid request body",
      };
    }

    const crypto = require("crypto");
    let uuid = crypto.randomUUID();

    const filename = uuid + "-new.pdf";

    let docContent = `<!DOCTYPE html><html class="landscape"><body class="landscape">
    <style type="text/css">
    @page { size: a4 landscape; margin: 0; }
    html, body{ height:100%; font-family: Verdana, sans-serif; }
    html.landscape, html.landscape{ size: a4 landscape; margin: 0; }
    .page {position: relative; overflow: hidden; page-break-after: always; padding: 0; }
    .page.landscape { width: 11.7in; height: 8.2in; }
    .page.portrait { width: 8.3in; height: 11.6in; }
    .middle { width: 100%; height:90%; position:absolute; top:0px; bottom:0px; margin: auto; margin-top: 0px !important; padding: 2rem; }
    .label-grid { box-sizing: border-box; display: grid; grid-template-columns: 1fr 1fr 1fr; grid-gap: 20px; font-size: 2rem; }
    .label { border: dashed 4px black; width:85%; padding: 20px; font-size: 1.5rem; }
    .label p, .label-footer p { margin: 0; }
    .label-footer { display: grid; grid-template-columns: 1fr 0.4fr; grid-gap: 20px; margin-top: 20px; width:100%; }
    .label .id { }
    .label .code { font-size:0.75rem; text-align: center; }
    .label .code img { margin:0 auto; width:100%; max-width:160px; display:block; }
    .ellipsis { font-size:1.5rem; letter-spacing: 0.25rem; }
    </style>`;

    interface PDFPages {
      template: string;
      qrCode: string;
      replaceStrings: any;
    }

    const pdfPages: [PDFPages] = event.body?.pdfPages ?? [];

    for (const [key, p] of pdfPages.entries()) {
      if (p.template) {
        let pageContent = pdfTemplates[p.template];

        if (p.qrCode) {
          const qrCode = await QRCode.toDataURL(p.qrCode);
          pageContent = pageContent.replace(/###QR_CODE###/g, qrCode);
        }
        if (p.replaceStrings) {
          for (const [find, replace] of Object.entries(p.replaceStrings)) {
            const re = new RegExp(find, "g");
            pageContent = pageContent.replace(re, replace);
          }
        }
        docContent += pageContent;
      }
    }

    docContent += `</body></html>`;
    console.log("Doc Content To Generate: ");
    console.log(docContent);
    const pdfBuffer = await generatePdfBuffer(docContent);

    if (!pdfBuffer) {
      throw new Error("Failed to created PDF buffer from HTML");
    }
    const s3Upload = new Upload({
      client: s3Client,
      params: {
        Bucket: process.env.S3_PDF_BUCKET,
        Body: pdfBuffer,
        Key: filename,
      },
    });
    s3Upload.on("httpUploadProgress", (progress) => {
      console.log(progress);
    });
    await s3Upload.done();

    const dateDifferenceInSeconds = (dateInitial: number, dateFinal: number) =>
      Math.round((dateFinal - dateInitial) / 1_000);

    const presignedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: process.env.S3_PDF_BUCKET,
        Key: filename,
      }),
      {
        expiresIn: 3600,
      }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        pdfUrl: `https://${process.env.S3_PDF_BUCKET}.s3.eu-west-2.amazonaws.com/${filename}`, //presignedUrl,
        location: process.env.S3_PDF_BUCKET,
        filename: filename,
      }),
    };
  } catch (error) {
    console.log("Error converting HTML to PDF", error);
    return {
      statusCode: 500,
      body: "Internal server error",
    };
  }
};
