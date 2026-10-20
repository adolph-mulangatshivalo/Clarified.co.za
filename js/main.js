/**
 * Clarified theme — front-end interactivity.
 *
 * Everything the original script.js did to render content (renderHome,
 * renderListing, renderArticle, renderSearch, and their card/escapeHtml/
 * getReadingTime/getTags/articleSections/relatedArticles helpers) is now
 * done server-side in PHP. This file keeps only the parts that are
 * genuinely front-end behaviour: the mobile menu toggle, the newsletter
 * form's client-side confirmation state, and the "copy link" button.
 * The contact form now posts to a real handler (see functions.php) so
 * it no longer needs a JS fallback.
 */
(function () {
	'use strict';

	function $(selector, root) {
		return (root || document).querySelector(selector);
	}

	function setupMenu() {
		var menu = $('.menu');
		var panel = $('.mobile-menu-panel');
		if (!menu || !panel) return;

		menu.addEventListener('click', function (e) {
			e.preventDefault();
			var open = !panel.classList.contains('open');
			panel.classList.toggle('open', open);
			menu.classList.toggle('is-open', open);
			menu.setAttribute('aria-expanded', String(open));
			panel.setAttribute('aria-hidden', String(!open));
		});

		panel.querySelectorAll('a').forEach(function (a) {
			a.addEventListener('click', function () {
				panel.classList.remove('open');
				menu.classList.remove('is-open');
				menu.setAttribute('aria-expanded', 'false');
				panel.setAttribute('aria-hidden', 'true');
			});
		});
	}

	function setupNewsletterForm() {
		document.querySelectorAll('#newsletter-form').forEach(function (form) {
			form.addEventListener('submit', function (e) {
				e.preventDefault();
				var button = form.querySelector('button');
				if (button) {
					button.textContent = "You're on the list ✓";
					button.disabled = true;
				}
			});
		});
	}

	function setupCopyLink() {
		var button = $('#copy-link');
		if (!button) return;
		button.addEventListener('click', async function () {
			var url = button.getAttribute('data-url') || window.location.href;
			try {
				await navigator.clipboard.writeText(url);
				button.textContent = 'Link copied';
			} catch (err) {
				button.textContent = 'Copy unavailable';
			}
		});
	}

	document.addEventListener('DOMContentLoaded', function () {
		setupMenu();
		setupNewsletterForm();
		setupCopyLink();
	});
})();
