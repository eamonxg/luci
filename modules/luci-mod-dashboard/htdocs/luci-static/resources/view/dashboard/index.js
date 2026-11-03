'use strict';
'require view';
'require poll';
'require ui';
'require network';
'require view.dashboard.lib.widgets as widgets';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet',
	'type': 'text/css',
	'href': L.resource('view/dashboard/css/custom.css') + (L.env.resource_version ? '?v=' + L.env.resource_version : '')
}));

const ROWS = {
	cards: { max: 5, shortFirst: false },
	charts: { max: 3, shortFirst: true }
};

function invokeIncludesLoad(includes, layout) {
	const tasks = [];
	let has_load = false;

	for (let i = 0; i < includes.length; i++) {
		const declared = includes[i].widgets || [];

		includes[i].failed = false;

		includes[i].skipped = (declared.length > 0 && !declared.some(widget => layout[widget.slot]?.includes(widget.id)));

		if (includes[i].skipped) {
			tasks.push(null);
		}
		else if (typeof(includes[i].load) == 'function') {
			tasks.push(includes[i].load().catch(function(e) {
				console.error(e);
				this.failed = true;
			}.bind(includes[i])));

			has_load = true;
		}
		else {
			tasks.push(null);
		}
	}

	return has_load ? Promise.all(tasks) : Promise.resolve(null);
}

function collectSections(includes, results, layout) {
	const sections = { cards: [], charts: [], tabs: [], extra: [] };
	const found = { cards: {}, charts: {}, tabs: {} };

	for (let i = 0; i < includes.length; i++) {
		let content = null;

		if (includes[i].failed || includes[i].skipped)
			continue;

		try {
			if (typeof(includes[i].render) == 'function')
				content = includes[i].render(results ? results[i] : null);
			else if (includes[i].content != null)
				content = includes[i].content;

			if (content == null)
				continue;

			if (content instanceof Node || Array.isArray(content)) {
				sections.extra.push(content);
				continue;
			}

			// Items may defer building their node or tab content until selected.
			// Includes without widget declarations keep their original behavior.
			for (const slot of widgets.slots)
				(content[slot] || (slot == 'cards' ? content.kpi : null) || []).forEach(item => {
					if (item instanceof Node)
						sections[slot].push(item);
					else if (includes[i].widgets == null)
						sections[slot].push((slot == 'tabs') ? item : item.node);
					else if (layout[slot].includes(item.id)) {
						const value = (slot == 'tabs') ? item.content : item.node;
						const node = (typeof(value) == 'function') ? value() : value;

						found[slot][item.id] = (slot == 'tabs') ? Object.assign({}, item, { content: node }) : node;
					}
				});
		}
		catch (e) {
			console.error(e);
			continue;
		}
	}

	for (const slot of widgets.slots)
		sections[slot] = layout[slot].map(id => found[slot][id]).filter(item => item != null).concat(sections[slot]);

	return sections;
}

// Split n items into rows of at most max items, as evenly as possible.
function rowSizes(n, max, shortFirst) {
	const rows = Math.ceil(n / max);
	const base = Math.floor(n / rows);
	const extra = n % rows;
	const sizes = [];

	for (let i = 0; i < rows; i++)
		sizes.push(base + ((shortFirst ? i >= rows - extra : i < extra) ? 1 : 0));

	return sizes;
}

function fillRows(nodes, slot) {
	let i = 0;
	const regular = nodes.filter(node => {
		if (node.dataset.dashboardSpan != 'full')
			return true;
		node.style.setProperty('--dashboard-per-row', 1);
		return false;
	});

	rowSizes(regular.length, ROWS[slot].max, ROWS[slot].shortFirst).forEach(size => {
		for (let n = 0; n < size; n++)
			regular[i++].style.setProperty('--dashboard-per-row', size);
	});

	return nodes;
}

function updateShell(root, sections, containers) {
	const desired = [
		sections.cards.length ? containers.cards : null,
		sections.charts.length ? containers.charts : null,
		sections.tabs.length ? containers.tabs : null,
		sections.extra.length ? containers.extra : null
	].filter(Boolean);

	desired.forEach((node, i) => {
		if (root.children[i] !== node)
			root.insertBefore(node, root.children[i] || null);
	});

	while (root.children.length > desired.length)
		root.removeChild(root.lastChild);
}

function updateCharts(container, chartNodes) {
	const scrollPositions = {};
	container.querySelectorAll('[data-chart]').forEach(el => {
		if (el.dataset.chart)
			scrollPositions[el.dataset.chart] = el.scrollLeft;
	});

	updateNodes(container, fillRows(chartNodes, 'charts'));

	container.querySelectorAll('[data-chart]').forEach(el => {
		if (el.dataset.chart && scrollPositions[el.dataset.chart] != null)
			el.scrollLeft = scrollPositions[el.dataset.chart];
	});
}

// Retained widgets need no detach/attach cycle on unchanged samples.
function updateNodes(container, nodes) {
	nodes.forEach((node, i) => {
		if (container.children[i] !== node)
			container.insertBefore(node, container.children[i] || null);
	});
	while (container.children.length > nodes.length)
		container.removeChild(container.lastChild);
}

function updateTabs(tabMap, tabGroup, items, form) {
	const menu = tabMap.querySelector('.cbi-tabmenu');
	const existingPanes = Array.from(tabGroup.children);
	const existingIds = existingPanes.map(pane => pane.dataset.tab);
	const itemIds = items.map(tab => tab.id);

	const changed = !tabGroup.hasAttribute('data-initialized') ||
		existingIds.length !== itemIds.length ||
		existingIds.some((id, i) => id !== itemIds[i]);

	if (changed) {
		if (menu)
			menu.remove();
		tabGroup.removeAttribute('data-initialized');

		const activePane = existingPanes.find(p => p.getAttribute('data-tab-active') === 'true');
		const activeId = activePane ? activePane.dataset.tab : null;

		while (tabGroup.firstChild)
			tabGroup.removeChild(tabGroup.firstChild);

		items.forEach(tab => {
			const pane = (tab.id === 'layout' && form) ? form : E('div', {
				'class': 'cbi-section',
				'id': 'dashboard-detail-' + tab.id,
				'data-tab': tab.id,
				'data-tab-title': (tab.count != null) ? '%s (%d)'.format(tab.title, tab.count) : tab.title
			}, (typeof(tab.content) == 'function') ? tab.content() : tab.content);

			if (tab.id === activeId)
				pane.setAttribute('data-tab-active', 'true');

			tabGroup.appendChild(pane);
		});

		ui.tabs.initTabGroup(tabGroup.childNodes);
	}
	else {
		items.forEach(tab => {
			const pane = tabGroup.querySelector(':scope > [data-tab="' + tab.id + '"]');
			if (!pane)
				return;

			const newTitle = (tab.count != null) ? '%s (%d)'.format(tab.title, tab.count) : tab.title;
			if (pane.dataset.tabTitle !== newTitle) {
				pane.dataset.tabTitle = newTitle;
				const link = menu ? menu.querySelector('li[data-tab="' + tab.id + '"] > a') : null;
				if (link && link.textContent !== newTitle)
					link.textContent = newTitle;
			}

			if (tab.id === 'layout')
				return;

			const contentNode = (typeof(tab.content) == 'function') ? tab.content() : tab.content;
			if (contentNode) {
				if (pane.childNodes.length !== 1 || pane.firstChild !== contentNode)
					L.dom.content(pane, contentNode);
			}
		});
	}
}

function startPolling(includes, layout, root, form) {
	let loading = null;

	const showForm = () => {
		loading ??= L.require('view.dashboard.lib.layout')
			.then(layoutForm => layoutForm.render(includes))
			.then(node => L.dom.content(form, node));
	};

	if (form)
		form.addEventListener('cbi-tab-active', showForm);

	const cardsContainer = E('div', { 'class': 'dashboard-kpi-row' });
	const chartsContainer = E('div', { 'class': 'dashboard-charts' });
	const tabGroup = E('div', { 'class': 'cbi-map-tabbed' });
	const tabMap = E('div', { 'class': 'cbi-map' }, [ tabGroup ]);
	const extraContainer = E('div', {});

	const containers = {
		cards: cardsContainer,
		charts: chartsContainer,
		tabs: tabMap,
		extra: extraContainer
	};
	let returnSource = null;
	const headerOffset = () => {
		const header = document.querySelector('header');
		return header && [ 'fixed', 'sticky' ].includes(getComputedStyle(header).position)
			? Math.max(0, header.getBoundingClientRect().bottom) : 0;
	};
	const updateReturnLinks = () => {
		root.querySelectorAll('[data-dashboard-return]').forEach(link => {
			link.hidden = !returnSource?.isConnected;
		});
	};
	root.addEventListener('dashboard-client-filter', ev => {
		root.querySelectorAll('[data-dashboard-tab="wifi"]').forEach(link => {
			const selected = !!ev.detail.network && link.dataset.dashboardNetwork === ev.detail.network;
			if (selected) {
				link.setAttribute('aria-current', 'true');
				if (returnSource)
					returnSource = link;
			}
			else {
				link.removeAttribute('aria-current');
			}
		});
	});

	// Widgets declare destinations; the shell owns native LuCI tab activation.
	// Use the tab's own click handler so its state and events stay in sync.
	root.addEventListener('click', ev => {
		if (ev.target.closest('[data-dashboard-return]')) {
			ev.preventDefault();
			if (returnSource?.isConnected) {
				returnSource.focus({ preventScroll: true });
				const overview = returnSource.closest('[data-dashboard-overview]') || returnSource;
				window.scrollTo({ top: Math.max(0, window.scrollY + overview.getBoundingClientRect().top - headerOffset() - 16), behavior: 'auto' });
			}
			return;
		}
		const source = ev.target.closest('[data-dashboard-tab]');
		if (!source || !root.contains(source))
			return;
		ev.preventDefault();
		const id = source.dataset.dashboardTab;
		const tab = Array.from(tabMap.querySelectorAll('.cbi-tabmenu > li'))
			.find(node => node.dataset.tab == id)?.querySelector('a');
		const pane = Array.from(tabGroup.children).find(node => node.dataset.tab == id);
		if (!tab || !pane)
			return;
		if (source.closest('[data-dashboard-overview]'))
			returnSource = source;
		tab.click();
		const owner = includes.find(include => include.widgets?.some(widget => widget.slot == 'tabs' && widget.id == id));
		owner?.navigate?.({ network: source.dataset.dashboardNetwork || null });
		updateReturnLinks();
		const section = Array.from(pane.querySelectorAll('[data-dashboard-section]'))
			.find(node => node.dataset.dashboardSection == source.dataset.dashboardSection);
		const target = section || pane;
		target.tabIndex = -1;
		target.focus({ preventScroll: true });
		// Keep the tab bar in view when the section fits; on a narrow screen,
		// scroll straight to the requested list instead of stopping at cards.
		const headerBottom = headerOffset();
		const menu = tabMap.querySelector('.cbi-tabmenu');
		// Keep the active destination visible in horizontally scrolling themes.
		const menuRect = menu.getBoundingClientRect();
		const tabRect = tab.parentElement.getBoundingClientRect();
		if (tabRect.left < menuRect.left || tabRect.right > menuRect.right)
			menu.scrollLeft += tabRect.left - menuRect.left - (menu.clientWidth - tabRect.width) / 2;
		const menuTop = menu.getBoundingClientRect().top;
		const rect = target.getBoundingClientRect();
		const fits = rect.bottom - menuTop <= window.innerHeight - headerBottom - 32;
		const top = section && !fits ? rect.top : menuTop;
		window.scrollTo({ top: Math.max(0, window.scrollY + top - headerBottom - 16), behavior: 'auto' });
	});

	const step = () => {
		return network.flushCache().then(() => {
			return invokeIncludesLoad(includes, layout);
		}).then(results => {
			const sections = collectSections(includes, results, layout);

			if (form)
				sections.tabs.push({ id: 'layout', title: _('Settings'), content: [] });

			updateShell(root, sections, containers);

			if (sections.cards.length)
				updateNodes(cardsContainer, fillRows(sections.cards, 'cards'));

			if (sections.charts.length)
				updateCharts(chartsContainer, sections.charts);

			if (sections.tabs.length)
				updateTabs(tabMap, tabGroup, sections.tabs, form);

			root.querySelectorAll('[data-dashboard-tab]').forEach(link => {
				const available = sections.tabs.some(tab => tab.id == link.dataset.dashboardTab);
				link.disabled = !available;
				link.title = available ? '' : _('Enable this detail tab in Settings to view it.');
			});
			updateReturnLinks();

			if (sections.extra.length)
				L.dom.content(extraContainer, sections.extra);

			root.classList.add('fade-in');
		});
	};

	return step().then(() => {
		poll.add(step);

		// Only resume what was stopped here, not a poll the user has paused.
		let paused = false;

		document.addEventListener('visibilitychange', () => {
			if (document.hidden)
				paused = poll.stop();
			else if (paused)
				paused = !poll.start();
		});
	});
}

return view.extend({
	load() {
		return widgets.load().then(includes => {
			return widgets.layout(includes).then(layout => [ includes, layout ]);
		});
	},

	render([ includes, layout ]) {
		const root = E('div', { 'class': 'Dashboard' });

		document.addEventListener('uci-applied', () => window.location.reload());

		const form = L.hasViewPermission() ? E('div', { 'class': 'cbi-section', 'data-tab': 'layout', 'data-tab-title': _('Settings') }, [ E('em', { 'class': 'spinning' }, [ _('Loading view…') ]) ]) : null;

		return startPolling(includes, layout, root, form).then(() => root);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
