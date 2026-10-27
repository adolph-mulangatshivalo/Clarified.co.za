/**
 * Clarified.co.za - Article Page Interactive Features
 * Handles Social Share Buttons (WhatsApp, Facebook, X [icon only], Instagram, TikTok, Copy Link)
 */
(function () {
  'use strict';

  function initArticleShare() {
    var shareContainers = document.querySelectorAll('.article-share');
    if (!shareContainers.length) return;

    var url = window.location.href;
    var title = document.title.replace(/\s*—\s*Clarified.*$/i, '').trim();
    var encUrl = encodeURIComponent(url);
    var encTitle = encodeURIComponent(title);

    var svgStyle = 'width:16px;height:16px;max-width:16px;max-height:16px;display:inline-block;vertical-align:middle;flex-shrink:0;';

    var shareButtonsHtml = `
      <div class="share-buttons">
        <a class="share-btn share-whatsapp" href="https://api.whatsapp.com/send?text=${encTitle}%20${encUrl}" target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="${svgStyle}"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
          <span>WhatsApp</span>
        </a>
        <a class="share-btn share-facebook" href="https://www.facebook.com/sharer/sharer.php?u=${encUrl}" target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="${svgStyle}"><path d="M13.5 21v-7.5h2.5l.5-3h-3V8.5c0-.9.3-1.5 1.6-1.5H16.5V4.3c-.3 0-1.3-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2V10.5H7.5v3H10V21h3.5z"/></svg>
          <span>Facebook</span>
        </a>
        <a class="share-btn share-twitter" href="https://twitter.com/intent/tweet?url=${encUrl}&text=${encTitle}" target="_blank" rel="noopener noreferrer" aria-label="Share on Twitter">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="${svgStyle}"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          <span>Twitter</span>
        </a>
        <button type="button" class="share-btn share-instagram" aria-label="Share on Instagram">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="${svgStyle}"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.2" cy="6.8" r="1"/></svg>
          <span>Instagram</span>
        </button>
        <button type="button" class="share-btn share-tiktok" aria-label="Share on TikTok">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="${svgStyle}"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 2.25-1.15 4.39-2.9 5.8-1.75 1.39-4.04 2.15-6.28 1.96-2.21-.19-4.32-1.2-5.78-2.88-1.45-1.67-2.26-3.88-2.15-6.1.11-2.24 1.17-4.34 2.91-5.75 1.76-1.4 4.05-2.13 6.29-1.93h.05V12.1c-1.12-.13-2.26.07-3.21.6-1.07.57-1.87 1.56-2.17 2.73-.31 1.2.06 2.47.88 3.39.81.9 2.05 1.35 3.27 1.25 1.23-.1 2.37-.8 3.01-1.85.5-.83.74-1.81.7-2.78V.02h.01Z"/></svg>
          <span>TikTok</span>
        </button>
        <button type="button" class="share-btn share-copy" aria-label="Copy link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${svgStyle}"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          <span>Copy link</span>
        </button>
      </div>
    `;

    shareContainers.forEach(function (container) {
      container.innerHTML = '<strong>Share this article</strong>' + shareButtonsHtml;

      // Copy Link button event
      var copyBtn = container.querySelector('.share-copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', function () {
          navigator.clipboard.writeText(url).then(function () {
            var originalHtml = copyBtn.innerHTML;
            copyBtn.classList.add('copied');
            copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="' + svgStyle + '"><path d="M20 6L9 17l-5-5"/></svg><span>Copied!</span>';
            setTimeout(function () {
              copyBtn.classList.remove('copied');
              copyBtn.innerHTML = originalHtml;
            }, 2200);
          }).catch(function () {
            window.prompt('Copy article link:', url);
          });
        });
      }

      // Instagram button event
      var instaBtn = container.querySelector('.share-instagram');
      if (instaBtn) {
        instaBtn.addEventListener('click', function () {
          navigator.clipboard.writeText(url);
          var originalHtml = instaBtn.innerHTML;
          instaBtn.classList.add('copied');
          instaBtn.innerHTML = '<span>Link copied!</span>';
          setTimeout(function () {
            window.open('https://www.instagram.com', '_blank');
            instaBtn.classList.remove('copied');
            instaBtn.innerHTML = originalHtml;
          }, 600);
        });
      }

      // TikTok button event
      var tiktokBtn = container.querySelector('.share-tiktok');
      if (tiktokBtn) {
        tiktokBtn.addEventListener('click', function () {
          navigator.clipboard.writeText(url);
          var originalHtml = tiktokBtn.innerHTML;
          tiktokBtn.classList.add('copied');
          tiktokBtn.innerHTML = '<span>Link copied!</span>';
          setTimeout(function () {
            window.open('https://www.tiktok.com', '_blank');
            tiktokBtn.classList.remove('copied');
            tiktokBtn.innerHTML = originalHtml;
          }, 600);
        });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initArticleShare);
  } else {
    initArticleShare();
  }
})();
