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

            // Dynamic generation
            compareBtn.disabled = true;
            compareBtn.classList.add('loading');
            compareBtn.textContent = 'Generating...';

            fetch('/api/compare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: a + ' vs ' + b })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.error) {
                    compareError.textContent = data.error;
                    compareError.classList.add('active');
                    compareBtn.disabled = false;
                    compareBtn.classList.remove('loading');
                    compareBtn.textContent = 'Compare';
                    return;
                }
                window.location.href = '/' + data.slug + '/';
            })
            .catch(function() {
                compareError.textContent = 'Something went wrong. Please try again.';
                compareError.classList.add('active');
                compareBtn.disabled = false;
                compareBtn.classList.remove('loading');
                compareBtn.textContent = 'Compare';
            });
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
})();
