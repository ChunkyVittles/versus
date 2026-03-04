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

    // --- Dual-Input Compare ---
    var inputA = document.getElementById('input-a');
    var inputB = document.getElementById('input-b');
    var suggestA = document.getElementById('suggest-a');
    var suggestB = document.getElementById('suggest-b');
    var compareBtn = document.getElementById('compare-btn');
    var compareError = document.getElementById('compare-error');
    var searchData = window.VS_SEARCH_DATA || [];
    var items = window.VS_ITEMS || [];

    if (inputA && inputB && compareBtn) {

        function makeSlug(a, b) {
            a = a.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            b = b.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            if (a > b) { var t = a; a = b; b = t; }
            return a + '-vs-' + b;
        }

        function parseComparisonQuery(text) {
            text = text.trim();
            var patterns = [
                /^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i,
                /^(.+?)\s+(?:or)\s+(.+)$/i,
                /^(?:should\s+i\s+(?:buy|get|choose))\s+(.+?)\s+(?:or|vs\.?|versus)\s+(.+?)[\?]?$/i,
                /^(?:which\s+is\s+better)\s*[,:]?\s*(.+?)\s+(?:or|vs\.?|versus)\s+(.+?)[\?]?$/i,
                /^(?:is)\s+(.+?)\s+(?:better\s+than)\s+(.+?)[\?]?$/i,
                /^(.+?)\s+(?:compared\s+to|vs\.?|versus)\s+(.+)$/i,
                /^(?:difference\s+between)\s+(.+?)\s+(?:and|vs\.?)\s+(.+?)[\?]?$/i,
                /^(?:what\s+(?:should\s+i|to)\s+(?:buy|get|choose))\s*[,:]?\s*(.+?)\s+(?:or|vs\.?)\s+(.+?)[\?]?$/i,
            ];
            for (var i = 0; i < patterns.length; i++) {
                var m = text.match(patterns[i]);
                if (m) return { a: m[1].trim(), b: m[2].trim() };
            }
            return null;
        }

        function updateBtn() {
            compareBtn.disabled = !(inputA.value.trim().length >= 2 && inputB.value.trim().length >= 2);
        }

        function showSuggestions(input, dropdown) {
            var q = input.value.trim().toLowerCase();
            if (q.length < 1) { dropdown.classList.remove('active'); dropdown.innerHTML = ''; return; }
            var matches = items.filter(function(name) {
                return name.toLowerCase().indexOf(q) !== -1;
            }).slice(0, 6);
            if (!matches.length) { dropdown.classList.remove('active'); dropdown.innerHTML = ''; return; }
            dropdown.innerHTML = matches.map(function(m) {
                return '<div class="versus-suggest-item">' + m + '</div>';
            }).join('');
            dropdown.classList.add('active');
            dropdown.querySelectorAll('.versus-suggest-item').forEach(function(el) {
                el.addEventListener('mousedown', function(e) {
                    e.preventDefault();
                    input.value = this.textContent;
                    dropdown.classList.remove('active');
                    dropdown.innerHTML = '';
                    updateBtn();
                    // Focus the other input if empty
                    var other = (input === inputA) ? inputB : inputA;
                    if (!other.value.trim()) other.focus();
                });
            });
        }

        inputA.addEventListener('input', function() { updateBtn(); showSuggestions(inputA, suggestA); });
        inputB.addEventListener('input', function() { updateBtn(); showSuggestions(inputB, suggestB); });
        inputA.addEventListener('focus', function() { showSuggestions(inputA, suggestA); });
        inputB.addEventListener('focus', function() { showSuggestions(inputB, suggestB); });
        inputA.addEventListener('blur', function() { suggestA.classList.remove('active'); });
        inputB.addEventListener('blur', function() { suggestB.classList.remove('active'); });

        function doCompare() {
            var a = inputA.value.trim();
            var b = inputB.value.trim();

            // Try parsing a full query from input A if B is empty
            if (a && !b) {
                var parsed = parseComparisonQuery(a);
                if (parsed) {
                    a = parsed.a;
                    b = parsed.b;
                    inputA.value = a;
                    inputB.value = b;
                }
            }

            if (a.length < 2 || b.length < 2) return;

            compareError.textContent = '';
            compareError.classList.remove('active');

            var slug = makeSlug(a, b);

            // Check if comparison already exists
            var existing = searchData.find(function(c) { return c.slug === slug; });
            if (existing) {
                window.location.href = '/' + slug + '/';
                return;
            }

            // Navigate to skeleton page — it handles the API call
            compareBtn.disabled = true;
            window.location.href = '/' + slug + '/?a=' + encodeURIComponent(a) + '&b=' + encodeURIComponent(b);
        }

        compareBtn.addEventListener('click', doCompare);

        inputA.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); doCompare(); }
        });
        inputB.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); doCompare(); }
        });

        document.addEventListener('click', function(e) {
            if (!e.target.closest('.versus-input-side-a')) suggestA.classList.remove('active');
            if (!e.target.closest('.versus-input-side-b')) suggestB.classList.remove('active');
        });
    }

    // --- Site-Wide Search ---
    var sSearchBtn = document.getElementById('site-search-btn');
    var sSearchPanel = document.getElementById('site-search-panel');
    var sSearchInput = document.getElementById('site-search-input');
    var sSearchClose = document.getElementById('site-search-close');
    var sSearchResults = document.getElementById('site-search-results');
    var mobileSearchLink = document.getElementById('mobile-search-link');
    var sIndex = null;
    var sActiveIdx = -1;

    function escHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function highlightMatch(name, query) {
        var lower = name.toLowerCase();
        var idx = lower.indexOf(query);
        if (idx === -1) return escHtml(name);
        return escHtml(name.slice(0, idx)) +
            '<span class="search-result-match">' + escHtml(name.slice(idx, idx + query.length)) + '</span>' +
            escHtml(name.slice(idx + query.length));
    }

    function openSearch() {
        if (!sSearchPanel) return;
        sSearchPanel.classList.add('active');
        sSearchInput.focus();
        // Close mobile nav if open
        if (mobileNav && mobileNav.classList.contains('active')) {
            mobileNav.classList.remove('active');
            if (menuBtn) {
                var spans = menuBtn.querySelectorAll('span');
                spans[0].style.transform = '';
                spans[1].style.opacity = '';
                spans[2].style.transform = '';
            }
        }
        // Lazy-load index on first open
        if (!sIndex) {
            fetch('/search-index.json')
                .then(function(r) { return r.json(); })
                .then(function(data) { sIndex = data; })
                .catch(function() { sIndex = []; });
        }
    }

    function closeSearch() {
        if (!sSearchPanel) return;
        sSearchPanel.classList.remove('active');
        sSearchInput.value = '';
        sSearchResults.innerHTML = '';
        sActiveIdx = -1;
    }

    function updateSearchActive(items) {
        items.forEach(function(el, i) {
            el.classList.toggle('active', i === sActiveIdx);
            if (i === sActiveIdx) el.scrollIntoView({ block: 'nearest' });
        });
    }

    if (sSearchBtn) {
        sSearchBtn.addEventListener('click', openSearch);
    }

    if (mobileSearchLink) {
        mobileSearchLink.addEventListener('click', function(e) {
            e.preventDefault();
            openSearch();
        });
    }

    if (sSearchClose) {
        sSearchClose.addEventListener('click', closeSearch);
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && sSearchPanel && sSearchPanel.classList.contains('active')) {
            closeSearch();
        }
    });

    if (sSearchInput) {
        sSearchInput.addEventListener('input', function() {
            var q = this.value.trim().toLowerCase();
            sActiveIdx = -1;
            if (!sIndex || q.length < 2) {
                sSearchResults.innerHTML = '';
                return;
            }
            var matches = sIndex.filter(function(c) {
                return c.a.toLowerCase().indexOf(q) !== -1 || c.b.toLowerCase().indexOf(q) !== -1;
            }).slice(0, 12);

            if (!matches.length) {
                sSearchResults.innerHTML = '<div class="site-search-empty">No comparisons found for \u2018' + escHtml(q) + '\u2019</div>';
                return;
            }

            sSearchResults.innerHTML = matches.map(function(m) {
                var aName = highlightMatch(m.a, q);
                var bName = highlightMatch(m.b, q);
                var cat = m.c.replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
                return '<a href="/' + m.s + '/" class="site-search-result">' +
                    '<span class="site-search-result-names">' + aName + ' <span class="site-search-result-vs">vs</span> ' + bName + '</span>' +
                    '<span class="site-search-result-cat">' + cat + '</span>' +
                    '</a>';
            }).join('');
        });

        sSearchInput.addEventListener('keydown', function(e) {
            var items = sSearchResults.querySelectorAll('.site-search-result');
            if (!items.length) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                sActiveIdx = Math.min(sActiveIdx + 1, items.length - 1);
                updateSearchActive(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                sActiveIdx = Math.max(sActiveIdx - 1, -1);
                updateSearchActive(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (sActiveIdx >= 0 && items[sActiveIdx]) {
                    items[sActiveIdx].click();
                } else {
                    var sq = sSearchInput.value.trim();
                    if (sq.length >= 2) {
                        window.location.href = '/search/?q=' + encodeURIComponent(sq);
                    }
                }
            }
        });
    }

    // Close search when clicking outside
    document.addEventListener('click', function(e) {
        if (sSearchPanel && sSearchPanel.classList.contains('active') &&
            !e.target.closest('.site-search-panel') &&
            !e.target.closest('.site-search-btn') &&
            !e.target.closest('#mobile-search-link')) {
            closeSearch();
        }
    });
})();
