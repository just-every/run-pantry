// Retained inline styles use the existing customer document typography and palette.
export const statementStyle = `
*{box-sizing:border-box}
body{margin:0;padding:48px 20px;background:#f7f6fb;color:#101a33;font-family:Figtree,Arial,sans-serif;line-height:1.6}
.statement{max-width:960px;min-width:0;margin:0 auto;padding:36px;background:#fff;border-radius:14px;box-shadow:0 1px 2px #0000000d,0 14px 36px #00000014;overflow-wrap:anywhere}
.statement h1,.statement h2{font-family:'Schibsted Grotesk',Arial,sans-serif;color:#101a33}
.statement h1{margin:0 0 16px;font-size:30px;line-height:1.25;letter-spacing:-.01em}
.statement h2{margin:0;font-size:18px;font-weight:600}
.statement p{margin:0 0 20px;color:#5a6178}
.statement .from{margin:0 0 8px;color:#5b5f94;font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}
.statement .facts{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px 24px;margin:24px 0}
.statement .facts span{display:block;color:#5a6178;font-size:13px}
.statement .facts strong{display:block;font-size:15px;font-weight:600}
.statement table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:24px}
.statement th,.statement td{padding:12px 8px;border-bottom:1px solid #e5e3ed;text-align:left;vertical-align:top;overflow-wrap:anywhere}
.statement th{color:#5b5f94;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.statement th:first-child,.statement td:first-child{padding-left:0}
.statement th:last-child,.statement td:last-child{padding-right:0}
.statement th:nth-child(3){width:24%}
.statement .fig{text-align:right;font-variant-numeric:tabular-nums}
.statement a{color:#101a33;text-underline-offset:3px}
.statement a:focus-visible{outline:3px solid #0e8659;outline-offset:3px}
.statement .balance{padding-top:20px;border-top:1px solid #e5e3ed;font-size:19px;color:#101a33}
.statement .summary{font-size:14px}
.statement .note{font-size:13px}
@media(max-width:600px){
 body{padding:24px 16px}
 .statement{padding:28px 20px}
 .statement h1{font-size:26px}
 .statement .facts{grid-template-columns:minmax(0,1fr)}
 .statement table,.statement tbody{display:block}
 .statement thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
 .statement tr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 16px;padding:16px 0;border-bottom:1px solid #e5e3ed}
 .statement td{display:block;min-width:0;padding:0!important;border:0;font-size:14px}
 .statement td:before{content:attr(data-label);display:block;color:#5a6178;font-size:13px}
 .statement td:nth-child(3){grid-column:1/-1;grid-row:1}
 .statement td.fig{text-align:left}
}
@media print{body{padding:0;background:white}.statement{max-width:none;padding:0;box-shadow:none}.statement tr{break-inside:avoid}}
`
