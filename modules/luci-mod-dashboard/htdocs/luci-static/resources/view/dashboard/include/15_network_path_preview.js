'use strict';
'require baseclass';
'require view.dashboard.lib.charts as charts';
'require view.dashboard.lib.topology as topology';

const COLLAPSE_THRESHOLD = 5;

function cleanHostname(name, isClient) {
	const value = String(name ?? '');
	return isClient ? value.replace(/\.lan$/i, '') : value;
}

function text(node, value) {
	value = String(value ?? '');
	if (node.textContent !== value)
		node.textContent = value;
}

function attr(node, name, value) {
	if (value == null)
		node.removeAttribute(name);
	else if (node.getAttribute(name) !== String(value))
		node.setAttribute(name, value);
}

function reconcile(parent, children) {
	const retained = new Set(children);
	for (const child of Array.from(parent.children))
		if (!retained.has(child))
			child.remove();
	children.forEach((child, index) => {
		if (parent.children[index] !== child)
			parent.insertBefore(child, parent.children[index] || null);
	});
}

return baseclass.extend({
	widgets: [ {
		id: 'network_path_preview', slot: 'charts', title: _('Network topology'), order: 5,
		detailTabs: [ 'internet', 'system', 'wifi' ]
	} ],
	dataSources: [ 'router', 'wifi' ],
	topologySource: 'connections',

	load() {
		return topology.loadConnections();
	},

	getTopologyData() {
		return this.connectionData || null;
	},

	init() {
		if (this.node)
			return;
		if (!document.querySelector('link[data-dashboard-topology-style]'))
			document.head.appendChild(E('link', {
				rel: 'stylesheet', 'data-dashboard-topology-style': '',
				href: L.resource('view/dashboard/css/network-path-preview.css') +
					(L.env.resource_version ? '?v=' + L.env.resource_version : '')
			}));
		this.nodes = new Map();
		this.accessNodes = new Map();
		this.accessStates = new Map();
		this.selection = {};
		this.upstreams = E('div', { 'class': 'dashboard-topology-upstreams' });
		this.router = E('div', { 'class': 'dashboard-topology-router' });
		this.groups = E('ul', { 'class': 'dashboard-topology-groups', 'role': 'list' });
		this.clients = E('ul', { 'class': 'dashboard-topology-clients', 'role': 'list' });
		this.empty = E('p', { 'class': 'dashboard-topology-empty' });
		this.endpoints = E('div', { 'class': 'dashboard-topology-endpoints', id: 'dashboard-topology-endpoints' }, [ this.clients, this.empty ]);
		this.tree = E('div', { 'class': 'dashboard-topology-tree' }, [ this.upstreams, this.router, this.groups, this.endpoints ]);
		this.mobile = window.matchMedia('(max-width: 900px)');
		this.mobile.addEventListener('change', () => {
			const focused = document.activeElement;
			this.updateTree();
			if (this.node.contains(focused))
				focused.focus({ preventScroll: true });
		});
		this.upstreamEmpty = E('p', { 'class': 'dashboard-topology-empty' }, _('No upstream routes reported.'));
		this.notice = E('p', { 'class': 'dashboard-topology-message' });

		this.node = charts.card({
			title: _('Network topology'), className: 'dashboard-topology',
			body: [
				E('div', { 'class': 'dashboard-topology-columns', 'aria-hidden': 'true' }, [
					E('span', {}, _('Internet')), E('span', {}, _('This device')),
					E('span', {}, _('Networks')), E('span', {}, _('Interfaces and devices'))
				]),
				this.tree,
				this.notice
			]
		});
		this.node.dataset.dashboardSpan = 'full';
		this.node.dataset.dashboardOverview = 'network-topology';
		this.node.addEventListener('click', ev => {
			const group = ev.target.closest('[data-dashboard-group]');
			if (group)
				this.toggleGroup(group.dataset.dashboardGroup);
		});
		this.node.addEventListener('dashboard-topology-selection', ev => this.select(ev.detail || {}));
		this.node.addEventListener('dashboard-topology-reveal', ev => this.select(Object.assign({ tab: 'wifi' }, ev.detail)));
		if (typeof ResizeObserver === 'function') {
			this.observer = new ResizeObserver(() => this.updateConnectors());
			this.observer.observe(this.tree);
		}
	},

	toggleGroup(id) {
		if (!this.model?.groups.some(group => group.id === id && (group.members.length || group.access?.length)))
			return;
		this.collapsed = this.activeGroup === id && !this.collapsed;
		this.activeGroup = id;
		this.selection = {};
		this.updateTree();
	},

	findGroup(selection) {
		if (!selection)
			return null;
		if (selection.group)
			return this.model?.groups.find(group => group.id === selection.group);
		if (selection.client) {
			const candidates = this.model?.groups.filter(group => group.members.some(member =>
				(selection.network == null || member.network === selection.network) && member.mac === selection.client)) || [];
			return candidates.length === 1 ? candidates[0] : null;
		}
		if (!selection.tab && !selection.network)
			return null;
		return this.model?.groups.find(group => selection.tab === 'internet' ? group.network === selection.network : selection.tab === 'wifi'
				? group.wifiNetworks.includes(selection.network)
				: selection.tab != null && group.tab === selection.tab && group.network === selection.network);
	},

	select(selection) {
		this.selection = selection;
		const group = this.findGroup(selection);
		if (group) {
			this.activeGroup = group.id;
			this.collapsed = false;
			const index = group.members.findIndex(member => (selection.network == null || member.network === selection.network) && member.mac === selection.client);
			const member = group.members[index];
			if (member)
				this.accessStates.set(group.id + '|' + member.access, true);
			if (selection.access)
				this.accessStates.set(group.id + '|' + selection.access, true);
		}
		this.updateTree();
	},

	getNode(key, data, live, selected = false, expandable = false, expanded = selected) {
		live.add(key);
		let node = this.nodes.get(key);
		const interactive = expandable || !!data.tab;
		if (!node) {
			const icon = E('span', { 'class': 'dashboard-topology-icon', 'aria-hidden': 'true' });
			const name = E('span', { 'class': 'dashboard-topology-name' });
			const detail = E('span', { 'class': 'dashboard-topology-detail' });
			const toggle = E('span', { 'class': 'dashboard-topology-toggle', 'aria-hidden': 'true' });
			const button = E(interactive ? 'button' : 'div', { type: interactive ? 'button' : null, 'class': 'dashboard-topology-node' }, [ icon, name, detail, toggle ]);
			node = { button, icon, name, detail, toggle };
			this.nodes.set(key, node);
		}
		if ((node.button.tagName === 'BUTTON') !== interactive) {
			const replacement = E(interactive ? 'button' : 'div', { type: interactive ? 'button' : null, 'class': 'dashboard-topology-node' }, [ node.icon, node.name, node.detail, node.toggle ]);
			node.button.replaceWith(replacement);
			node.button = replacement;
		}
		node.toggle.hidden = !expandable;
		attr(node.icon, 'data-icon', data.icon);
		attr(node.button, 'data-dashboard-tab', expandable ? null : data.tab);
		attr(node.button, 'data-dashboard-group', expandable ? data.id : null);
		attr(node.button, 'aria-expanded', expandable ? String(expanded) : null);
		attr(node.button, 'aria-controls', expandable ? this.endpoints.id : null);
		attr(node.button, 'data-dashboard-network', data.network);
		attr(node.button, 'data-dashboard-client', data.mac);
		attr(node.button, 'data-dashboard-access', data.access);
		attr(node.button, 'data-dashboard-section', !expandable ? (data.tab === 'wifi' ? (data.mac ? 'clients' : 'networks') : null) : null);
		attr(node.button, 'data-active', data.active === false || data.relation === 'unknown' ? 'false' : null);
		attr(node.button, 'data-status', data.status || null);
		attr(node.button, 'aria-current', selected ? 'true' : null);
		const shownName = cleanHostname(data.name, !!data.mac);
		const description = [ data.detail, data.mac ? [ data.mac, data.context ].filter(Boolean).join(' · ') : null, data.gatewayAddresses?.join(' / ') ].filter(Boolean).join(' · ');
		const label = [ shownName, description ].filter(Boolean).join(' · ');
		attr(node.button, 'aria-label', expandable ? label : data.tab ? _('%s: go to details').format(label) : null);
		attr(node.name, 'title', data.name);
		attr(node.name, 'data-mac', data.mac && /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(shownName) ? 'true' : null);
		attr(node.detail, 'title', description);
		node.detail.hidden = !data.detail;
		text(node.name, shownName);
		text(node.detail, data.detail);
		return node.button;
	},

	updateConnectors() {
		if (!this.model || this.mobile.matches || this.endpoints.hidden)
			return;
		const icon = this.nodes.get('group:' + this.activeGroup)?.icon;
		if (!icon?.isConnected)
			return;
		const panel = this.endpoints.getBoundingClientRect();
		const origin = icon.getBoundingClientRect();
		const centers = [ origin.top + origin.height / 2 - panel.top ];
		const updates = [];
		for (const entry of this.accessNodes.values()) {
			if (entry.item.parentNode !== this.clients || entry.item.hidden)
				continue;
			const box = entry.header.getBoundingClientRect();
			updates.push([ entry.item, box.height / 2 ]);
			centers.push(box.top + box.height / 2 - panel.top);
		}
		for (const [ item, center ] of updates)
			attr(item, 'style', '--topology-access-center:' + center + 'px');
		attr(this.endpoints, 'style', '--topology-branch-start:' + Math.min(...centers) + 'px;--topology-branch-height:' + (Math.max(...centers) - Math.min(...centers)) + 'px');
	},

	overviewGroups(model, selectedId) {
		return model.groups.filter(group => group.id !== 'interfaces:unassigned' || group.id === selectedId)
			.sort((a, b) => Number(b.active === true) - Number(a.active === true));
	},

	overviewAccess(group) {
		const rank = access => {
			if (access.kind === 'unknown')
				return 0;
			if (access.members.length > 0)
				return access.active === false ? 3 : 4;
			return access.active === true ? 2 : access.active == null ? 1 : 0;
		};
		return (group?.access || [])
			.filter(access => access.members.length || access.active !== false || access.id === this.selection?.access)
			.sort((a, b) => rank(b) - rank(a));
	},

	accessPreview(group, access) {
		const key = group.id + '|' + access.id;
		const expanded = this.accessStates.has(key) ? this.accessStates.get(key) : access.members.length <= COLLAPSE_THRESHOLD;
		const members = expanded ? access.members : [];
		return { expanded, members };
	},

	accessNode(group, access, live) {
		const key = group.id + '|' + access.id;
		let entry = this.accessNodes.get(key);
		if (!entry) {
			const icon = E('span', { 'class': 'dashboard-topology-icon', 'aria-hidden': 'true' });
			const name = E('strong');
			const meta = E('span', { 'class': 'dashboard-topology-access-meta' });
			const count = E('span', { 'class': 'dashboard-topology-access-count' });
			const chevron = E('span', { 'class': 'dashboard-topology-chevron', 'aria-hidden': 'true' });
			const badge = E('span', { 'class': 'dashboard-topology-access-badge' });
			const children = E('ul', { id: 'dashboard-topology-access-' + (this.sequence = (this.sequence || 0) + 1), 'class': 'dashboard-topology-access-devices', 'role': 'list' });
			const toggleAccess = () => {
				this.accessStates.set(key, entry.toggleButton.getAttribute('aria-expanded') !== 'true');
				this.updateTree();
			};
			const toggleButton = E('button', {
				type: 'button', 'class': 'dashboard-topology-access-toggle',
				'aria-controls': children.id,
				click: toggleAccess
			}, [ count, chevron ]);
			const link = E(access.kind === 'wireless' ? 'button' : 'div', {
				type: access.kind === 'wireless' ? 'button' : null,
				'class': 'dashboard-topology-access-link',
				click: access.kind === 'wireless' ? null : () => {
					if (!entry.toggleButton.hidden)
						toggleAccess();
				}
			}, [ icon, E('span', { 'class': 'dashboard-topology-access-label' }, [ name, meta ]) ]);
			const header = E('div', { 'class': 'dashboard-topology-access-header' }, [ link, toggleButton, badge ]);
			entry = { icon, name, meta, count, badge, toggleButton, link, children, header, item: E('li', { 'class': 'dashboard-topology-access' }, [ header, children ]) };
			this.accessNodes.set(key, entry);
		}
		const { expanded, members } = this.accessPreview(group, access);
		const displayTitle = access.kind === 'unknown' ? _('Other devices') : access.name;
		const accessLabel = [ displayTitle, access.meta ].filter(Boolean).join(' · ');
		const hasMembers = access.members.length > 0;
		const badgeText = access.known === false ? '?' : !hasMembers && access.kind === 'wireless' ? '0' : '';
		attr(entry.icon, 'data-icon', access.icon);
		attr(entry.toggleButton, 'aria-expanded', String(expanded));
		attr(entry.toggleButton, 'aria-label', accessLabel + ' (' + access.members.length + ')');
		entry.toggleButton.hidden = !hasMembers;
		text(entry.count, hasMembers ? String(access.members.length) : '');
		text(entry.badge, badgeText);
		entry.badge.hidden = !badgeText;
		attr(entry.badge, 'data-zero', badgeText === '0' ? 'true' : null);
		attr(entry.link, 'data-dashboard-tab', access.kind === 'wireless' ? 'wifi' : null);
		attr(entry.link, 'data-dashboard-section', access.kind === 'wireless' ? 'networks' : null);
		attr(entry.link, 'data-dashboard-network', access.kind === 'wireless' ? access.network : group.network);
		attr(entry.link, 'data-dashboard-access', access.id);
		attr(entry.link, 'data-dashboard-interface', access.device);
		attr(entry.link, 'data-collapsible', access.kind !== 'wireless' && hasMembers ? 'true' : null);
		attr(entry.link, 'aria-label', access.kind === 'wireless' ? _('%s: go to details').format(accessLabel) : null);
		attr(entry.item, 'data-relation', access.kind === 'unknown' ? 'unknown' : 'logical');
		attr(entry.item, 'data-empty', !hasMembers && access.known !== false ? 'true' : null);
		attr(entry.item, 'data-access-key', key);
		attr(entry.header, 'data-active', access.active === false ? 'false' : null);
		text(entry.name, displayTitle);
		text(entry.meta, access.meta || '');
		entry.meta.hidden = !access.meta;
		attr(entry.name, 'title', access.detail || accessLabel);
		reconcile(entry.children, members.map(member => {
			const nodeKey = 'member:' + member.id;
			const button = this.getNode(nodeKey, member, live, member.mac === this.selection.client && member.network === this.selection.network);
			const cached = this.nodes.get(nodeKey);
			cached.item ||= E('li', {}, button);
			attr(cached.item, 'data-relation', member.relation);
			return cached.item;
		}));
		entry.children.hidden = !expanded || !members.length;
		return entry.item;
	},

	updateTopology(snapshot) {
		this.init();
		const focused = document.activeElement;
		const restoreFocus = !!this.selection.client && this.node?.contains(focused) &&
			focused?.dataset.dashboardClient === this.selection.client && focused?.dataset.dashboardNetwork === this.selection.network;
		this.model = topology.buildModel(snapshot);
		if (this.selection.client) {
			const group = this.findGroup(this.selection);
			if (group) {
				this.activeGroup = group.id;
				const index = group.members.findIndex(member =>
					(this.selection.network == null || member.network === this.selection.network) && member.mac === this.selection.client);
				if (index >= 0) {
					this.selection.network = group.members[index].network;
				}
			}
			else {
				this.selection = {};
			}
		}
		this.updateTree();
		if (restoreFocus && document.activeElement !== focused)
			Array.from(this.nodes.values()).find(node => node.button.dataset.dashboardClient === this.selection.client &&
				node.button.dataset.dashboardNetwork === this.selection.network)?.button.focus({ preventScroll: true });
	},

	updateTree() {
		const model = this.model;
		if (!model)
			return;
		const live = new Set();
		const candidates = this.overviewGroups(model, this.findGroup(this.selection)?.id);
		let group = candidates.find(group => group.id === this.activeGroup);
		if (!group) {
			group = candidates.find(group => group.members.length) || candidates[0];
			this.activeGroup = group?.id;
			this.collapsed = false;
		}
		reconcile(this.upstreams, model.upstreams.length ? model.upstreams.map(up => this.getNode('up:' + up.id, up, live)) : [ this.upstreamEmpty ]);
		attr(this.upstreams, 'data-has-upstreams', model.upstreams.length ? 'true' : null);
		attr(this.upstreams, 'data-single', model.upstreams.length === 1 ? 'true' : null);
		reconcile(this.router, [ this.getNode('router', model.router, live, this.selection.tab === 'system') ]);
		attr(this.router, 'data-has-upstreams', model.upstreams.length ? 'true' : null);
		attr(this.router, 'data-has-groups', candidates.length ? 'true' : null);
		attr(this.node, 'data-has-groups', candidates.length ? 'true' : null);
		attr(this.node, 'data-no-upstreams', !model.upstreams.length ? 'true' : null);


		const singleFixedGroup = candidates.length === 1 && !this.mobile.matches && !this.collapsed;
		reconcile(this.groups, candidates.map(item => {
			const key = 'group:' + item.id;
			const hasChildren = item.members.length > 0 || !!item.access?.length;
			const expandable = hasChildren && !singleFixedGroup;
			const activeBranch = item === group && !this.collapsed;
			const highlightCurrent = candidates.length > 1 && activeBranch;
			const button = this.getNode(key, Object.assign({}, item, { tab: hasChildren ? null : item.tab }), live, highlightCurrent, expandable, activeBranch);
			const cached = this.nodes.get(key);
			cached.item ||= E('li', {}, button);
			attr(cached.item, 'data-has-links', activeBranch && item.access?.length ? 'true' : null);
			return cached.item;
		}));
		const access = !this.collapsed ? this.overviewAccess(group) : [];
		reconcile(this.clients, access.map(item => this.accessNode(group, item, live)));
		attr(this.endpoints, 'data-has-links', access.length ? 'true' : null);
		this.groups.hidden = !candidates.length;
		this.endpoints.hidden = !group || this.collapsed;
		this.clients.hidden = !access.length;
		this.empty.hidden = !!access.length;
		text(this.empty, group?.summary || '');
		// Keep one set of nodes and focus state across responsive layouts.
		// On phones, expanding a network reveals its children directly below it.
		const branchParent = this.mobile.matches && group ? this.nodes.get('group:' + group.id).item : this.tree;
		if (this.endpoints.parentNode !== branchParent)
			branchParent.appendChild(this.endpoints);

		const notices = [];
		if (!model.interfacesAvailable)
			notices.push(_('Interface data unavailable.'));
		if (model.wifiSupported && !model.wifiAvailable)
			notices.push(_('Wireless data unavailable.'));
		if (model.partial)
			notices.push(_('Some attachment data is unavailable.'));
		text(this.notice, notices.join(' '));
		this.notice.hidden = !notices.length;
		for (const [key, entry] of this.accessNodes)
			if (entry.item.parentNode !== this.clients) {
				entry.item.remove();
				this.accessNodes.delete(key);
			}
		for (const key of this.accessStates.keys())
			if (!model.groups.some(group => group.access?.some(access => key === group.id + '|' + access.id)))
				this.accessStates.delete(key);
		if (typeof requestAnimationFrame === 'function')
			requestAnimationFrame(() => this.updateConnectors());
		for (const id of this.nodes.keys())
			if (!live.has(id))
				this.nodes.delete(id);
	},

	render(data) {
		this.connectionData = data;
		return {
			charts: [ { id: 'network_path_preview', node: () => { this.init(); return this.node; } } ]
		};
	}
});
