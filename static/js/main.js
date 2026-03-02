/* VersusThat — Main JS */
(function() {
    'use strict';

    // --- Mobile Menu ---
    const menuBtn = document.querySelector('.mobile-menu-btn');
    const mobileNav = document.querySelector('.mobile-nav');
    if (menuBtn && mobileNav) {
        menuBtn.addEventListener('click', function() {
            mobileNav.classList.toggle('active');
            const spans = menuBtn.querySelectorAll('span');
            if (mobileNav.classList.contains('active')) {
                spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
                spans[1].style.opacity = '0';
                spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
            } else {
                spans[0].style.transform = '';
                spans[1].style.opacity = '';
                spans[2].style.transform = '';
            }
        });
    }

    // --- FAQ Accordion ---
    document.querySelectorAll('.faq-question').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var expanded = this.getAttribute('aria-expanded') === 'true';
            var answer = this.nextElementSibling;

            // Close all others
            document.querySelectorAll('.faq-question').forEach(function(other) {
                other.setAttribute('aria-expanded', 'false');
                other.nextElementSibling.classList.remove('open');
            });

            if (!expanded) {
                this.setAttribute('aria-expanded', 'true');
                answer.classList.add('open');
            }
        });
    });

    // --- Search Autocomplete ---
    var searchInput = document.getElementById('search-input');
    var searchResults = document.getElementById('search-results');
    var searchData = window.VS_SEARCH_DATA || [];

    if (searchInput && searchResults && searchData.length > 0) {
        var activeIndex = -1;

        searchInput.addEventListener('input', function() {
            var query = this.value.trim().toLowerCase();
            activeIndex = -1;

            if (query.length < 2) {
                searchResults.classList.remove('active');
                searchResults.innerHTML = '';
                return;
            }

            var matches = searchData.filter(function(item) {
                var haystack = (item.a + ' vs ' + item.b + ' ' + item.cat).toLowerCase();
                return haystack.indexOf(query) !== -1;
            }).slice(0, 8);

            if (matches.length === 0) {
                searchResults.classList.remove('active');
                searchResults.innerHTML = '';
                return;
            }

            searchResults.innerHTML = matches.map(function(m, i) {
                return '<div class="search-result-item" data-index="' + i + '" data-slug="' + m.slug + '">'
                    + '<span>' + m.a + '</span>'
                    + '<span class="search-result-vs">vs</span>'
                    + '<span>' + m.b + '</span>'
                    + '</div>';
            }).join('');

            searchResults.classList.add('active');

            // Click handlers
            searchResults.querySelectorAll('.search-result-item').forEach(function(el) {
                el.addEventListener('click', function() {
                    window.location.href = '/' + this.dataset.slug + '/';
                });
            });
        });

        // Keyboard navigation
        searchInput.addEventListener('keydown', function(e) {
            var items = searchResults.querySelectorAll('.search-result-item');
            if (!items.length) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIndex = Math.min(activeIndex + 1, items.length - 1);
                updateActive(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIndex = Math.max(activeIndex - 1, 0);
                updateActive(items);
            } else if (e.key === 'Enter' && activeIndex >= 0) {
                e.preventDefault();
                window.location.href = '/' + items[activeIndex].dataset.slug + '/';
            } else if (e.key === 'Escape') {
                searchResults.classList.remove('active');
            }
        });

        function updateActive(items) {
            items.forEach(function(el, i) {
                el.classList.toggle('active', i === activeIndex);
            });
        }

        // Close on outside click
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.search-box')) {
                searchResults.classList.remove('active');
            }
        });
    }
})();
