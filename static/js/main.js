/* VersusThat — Main JS */
(function() {
    'use strict';

    // --- Mobile Menu ---
    var menuBtn = document.querySelector('.mobile-menu-btn');
    var mobileNav = document.querySelector('.mobile-nav');
    if (menuBtn && mobileNav) {
        menuBtn.addEventListener('click', function() {
            mobileNav.classList.toggle('active');
            var spans = menuBtn.querySelectorAll('span');
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

    // --- Search Autocomplete + Dynamic Generation ---
    var searchInput = document.getElementById('search-input');
    var searchResults = document.getElementById('search-results');
    var searchData = window.VS_SEARCH_DATA || [];

    if (searchInput && searchResults) {
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
                // No existing match — offer to generate if query looks like "X vs Y"
                var vsMatch = query.match(/(.+?)\s+vs\.?\s+(.+)/i);
                if (vsMatch) {
                    var termA = vsMatch[1].trim();
                    var termB = vsMatch[2].trim();
                    // Capitalize first letters for display
                    var displayA = termA.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
                    var displayB = termB.replace(/\b\w/g, function(c) { return c.toUpperCase(); });

                    searchResults.innerHTML = '<div class="search-result-generate" id="generate-btn">'
                        + '<span class="generate-icon">&#10024;</span>'
                        + '<span>Generate: <strong>' + displayA + ' vs ' + displayB + '</strong></span>'
                        + '<span class="generate-label">AI-powered</span>'
                        + '</div>';
                    searchResults.classList.add('active');

                    document.getElementById('generate-btn').addEventListener('click', function() {
                        generateComparison(query);
                    });
                } else {
                    searchResults.classList.remove('active');
                    searchResults.innerHTML = '';
                }
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

            searchResults.querySelectorAll('.search-result-item').forEach(function(el) {
                el.addEventListener('click', function() {
                    window.location.href = '/' + this.dataset.slug + '/';
                });
            });
        });

        // Keyboard navigation
        searchInput.addEventListener('keydown', function(e) {
            var items = searchResults.querySelectorAll('.search-result-item, .search-result-generate');
            if (!items.length) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIndex = Math.min(activeIndex + 1, items.length - 1);
                updateActive(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIndex = Math.max(activeIndex - 1, 0);
                updateActive(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (activeIndex >= 0 && items[activeIndex]) {
                    items[activeIndex].click();
                } else if (items.length === 1 && items[0].classList.contains('search-result-generate')) {
                    items[0].click();
                }
            } else if (e.key === 'Escape') {
                searchResults.classList.remove('active');
            }
        });

        function updateActive(items) {
            items.forEach(function(el, i) {
                el.classList.toggle('active', i === activeIndex);
            });
        }

        document.addEventListener('click', function(e) {
            if (!e.target.closest('.search-box')) {
                searchResults.classList.remove('active');
            }
        });
    }

    // --- Dynamic Comparison Generation ---
    function generateComparison(query) {
        var sr = document.getElementById('search-results');

        sr.innerHTML = '<div class="search-result-loading">'
            + '<div class="loading-spinner"></div>'
            + '<span>Generating comparison... this takes about 15 seconds</span>'
            + '</div>';

        fetch('/api/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query })
        })
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (data.error) {
                sr.innerHTML = '<div class="search-result-error">'
                    + '<span>&#9888;&#65039; ' + data.error + '</span>'
                    + '</div>';
                return;
            }
            window.location.href = '/' + data.slug + '/';
        })
        .catch(function() {
            sr.innerHTML = '<div class="search-result-error">'
                + '<span>&#9888;&#65039; Something went wrong. Please try again.</span>'
                + '</div>';
        });
    }
})();
