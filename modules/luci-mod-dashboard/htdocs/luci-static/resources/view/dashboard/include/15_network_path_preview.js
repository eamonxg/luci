'use strict';
'require baseclass';
'require view.dashboard.lib.charts as charts';
'require view.dashboard.lib.topology as topology';
'require view.dashboard.lib.connections as connections';

const PAGE_SIZE = 8;

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
		detailTabs: [ 'internet', 'system', 'wifi', 'connections' ]
	}, { id: 'connections', slot: 'tabs', title: _('Network'), order: 45, hidden: true } ],
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
		this.pages = new Map();
		this.accessNodes = new Map();
		this.closedAccess = new Set();
		this.unplacedPage = 0;
		this.selection = {};
		this.upstreams = E('div', { 'class': 'dashboard-topology-upstreams' });
		this.router = E('div', { 'class': 'dashboard-topology-router' });
		this.groups = E('ul', { 'class': 'dashboard-topology-groups' });
		this.clients = E('ul', { 'class': 'dashboard-topology-clients' });
		this.empty = E('p', { 'class': 'dashboard-topology-empty' });
		this.allInterfaces = E('button', { type: 'button', 'class': 'cbi-button', 'data-dashboard-tab': 'connections', 'data-dashboard-section': 'interfaces', hidden: true });
		this.endpoints = E('div', { 'class': 'dashboard-topology-endpoints', id: 'dashboard-topology-endpoints' }, [ this.clients, this.empty, this.allInterfaces ]);
		this.tree = E('div', { 'class': 'dashboard-topology-tree' }, [ this.upstreams, this.router, this.groups, this.endpoints ]);
		this.mobile = window.matchMedia('(max-width: 900px)');
		this.mobile.addEventListener('change', () => {
			const focused = document.activeElement;
			this.updateTree();
			if (this.node.contains(focused))
				focused.focus({ preventScroll: true });
		});
		this.upstreamEmpty = E('p', { 'class': 'dashboard-topology-empty' }, _('No upstream routes reported.'));
		this.previous = E('button', { type: 'button', 'class': 'cbi-button', click: () => this.changePage(-1) }, _('Previous'));
		this.next = E('button', { type: 'button', 'class': 'cbi-button', click: () => this.changePage(1) }, _('Next'));
		this.range = E('span', { role: 'status' });
		this.pager = E('div', { 'class': 'dashboard-topology-pager' }, [ this.range, this.previous, this.next ]);
		this.status = E('div', { 'class': 'dashboard-topology-status' }, [ this.pager ]);
		this.notice = E('p', { 'class': 'dashboard-topology-message' });
		this.unplacedList = E('ul', { 'class': 'dashboard-topology-unplaced-list' });
		this.unplacedTitle = E('summary');
		this.unplacedRange = E('span', { role: 'status' });
		this.unplacedPrevious = E('button', { type: 'button', 'class': 'cbi-button', click: () => { this.unplacedPage--; this.updateTree(); } }, _('Previous'));
		this.unplacedNext = E('button', { type: 'button', 'class': 'cbi-button', click: () => { this.unplacedPage++; this.updateTree(); } }, _('Next'));
		this.unplacedPager = E('div', { 'class': 'dashboard-topology-pager' }, [ this.unplacedRange, this.unplacedPrevious, this.unplacedNext ]);
		this.unplaced = E('details', { 'class': 'dashboard-topology-unplaced' }, [
			this.unplacedTitle,
			this.unplacedList, this.unplacedPager
		]);
		this.allNetworks = E('button', { type: 'button', 'class': 'cbi-button', 'data-dashboard-tab': 'connections', 'data-dashboard-section': 'networks', hidden: true });
		this.node = charts.card({
			title: _('Network topology'), className: 'dashboard-topology',
			body: [
				E('div', { 'class': 'dashboard-topology-columns', 'aria-hidden': 'true' }, [
					E('span', {}, _('Upstream routes')), E('span', {}, _('This device')),
					E('span', {}, _('Networks')), E('span', {}, _('Interfaces and devices'))
				]),
				this.allNetworks,
				this.tree,
				this.status,
				this.unplaced,
				E('details', { 'class': 'dashboard-topology-help' }, [ E('summary', {}, _('About this topology')),
					E('p', {}, _('This view combines network membership, wireless associations and interface discovery. Discovery via an interface does not prove a direct cable connection. Address records do not prove Internet access.')) ]),
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
		if (selection.group)
			return this.model?.groups.find(group => group.id === selection.group);
		if (selection.client) {
			const candidates = this.model?.groups.filter(group => group.members.some(member =>
				(selection.network == null || member.network === selection.network) && member.mac === selection.client)) || [];
			return candidates.length === 1 ? candidates[0] : null;
		}
		return this.model?.groups.find(group => selection.tab === 'connections' ? group.network === selection.network : selection.tab === 'wifi'
				? group.wifiNetworks.includes(selection.network)
				: group.tab === selection.tab && group.network === selection.network);
	},

	select(selection) {
		this.selection = selection;
		const group = this.findGroup(selection);
		if (group && (group.members.length || group.access?.length)) {
			this.activeGroup = group.id;
			this.collapsed = false;
			const index = group.members.findIndex(member => (selection.network == null || member.network === selection.network) && member.mac === selection.client);
			if (index >= 0)
				this.pages.set(group.id, Math.floor(index / PAGE_SIZE));
			const member = group.members[index];
			if (member)
				this.closedAccess.delete(group.id + '|' + member.access);
			if (selection.access)
				this.closedAccess.delete(group.id + '|' + selection.access);
		}
		else if (selection.client) {
			const index = this.model?.unplaced.findIndex(member => member.mac === selection.client) ?? -1;
			if (index >= 0) {
				this.unplacedPage = Math.floor(index / PAGE_SIZE);
				this.unplaced.open = true;
			}
		}
		this.updateTree();
	},

	changePage(delta) {
		const group = this.model?.groups.find(group => group.id === this.activeGroup);
		if (!group)
			return;
		this.pages.set(group.id, Math.max(0, Math.min(Math.ceil(group.members.length / PAGE_SIZE) - 1, (this.pages.get(group.id) || 0) + delta)));
		this.selection = {};
		this.updateTree();
	},

	getNode(key, data, live, selected = false, expandable = false) {
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
		attr(node.button, 'aria-expanded', expandable ? String(selected) : null);
		attr(node.button, 'aria-controls', expandable ? this.endpoints.id : null);
		attr(node.button, 'data-dashboard-network', data.network);
		attr(node.button, 'data-dashboard-client', data.mac);
		attr(node.button, 'data-dashboard-access', data.access);
		attr(node.button, 'data-dashboard-section', !expandable && data.tab === 'wifi' ? (data.mac ? 'clients' : 'networks') : null);
		attr(node.button, 'data-active', data.active === false || data.relation === 'unknown' ? 'false' : null);
		attr(node.button, 'aria-current', selected ? 'true' : null);
		const description = [ data.detail, data.mac ? data.context : null, data.gatewayAddresses?.join(' / ') ].filter(Boolean).join(' · ');
		const label = [ data.name, description ].filter(Boolean).join(' · ');
		attr(node.button, 'aria-label', expandable
			? (selected ? _('Collapse %s') : _('Expand %s')).format(label)
			: data.tab ? _('%s: go to details').format(label) : null);
		attr(node.name, 'title', data.name);
		attr(node.detail, 'title', description);
		text(node.name, data.name);
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
		for (const entry of this.accessNodes.values()) {
			if (entry.item.parentNode !== this.clients || entry.item.hidden)
				continue;
			const box = entry.header.getBoundingClientRect();
			attr(entry.item, 'style', '--topology-access-center:' + box.height / 2 + 'px');
			centers.push(box.top + box.height / 2 - panel.top);
		}
		attr(this.endpoints, 'style', '--topology-branch-start:' + Math.min(...centers) + 'px;--topology-branch-height:' + (Math.max(...centers) - Math.min(...centers)) + 'px');
	},

	accessNode(group, access, members, live) {
		const key = group.id + '|' + access.id;
		let entry = this.accessNodes.get(key);
		if (!entry) {
			const icon = E('span', { 'class': 'dashboard-topology-icon', 'aria-hidden': 'true' });
			const name = E('strong');
			const detail = E('span', { 'class': 'dashboard-topology-access-detail' });
			const toggle = E('span', { 'class': 'dashboard-topology-toggle', 'aria-hidden': 'true' });
			const children = E('ul', { id: 'dashboard-topology-access-' + (this.sequence = (this.sequence || 0) + 1), 'class': 'dashboard-topology-access-devices' });
			const toggleButton = E('button', {
				type: 'button', 'class': 'dashboard-topology-access-toggle',
				'aria-controls': children.id,
				click: () => {
					if (this.closedAccess.has(key))
						this.closedAccess.delete(key);
					else
						this.closedAccess.add(key);
					this.updateTree();
				}
			}, toggle);
			const link = E('button', { type: 'button', 'class': 'dashboard-topology-access-link', 'data-dashboard-tab': 'connections' }, [
				icon, E('span', { 'class': 'dashboard-topology-access-label' }, [ name, detail ])
			]);
			const header = E('div', { 'class': 'dashboard-topology-access-header' }, [ link, toggleButton ]);
			entry = { icon, name, detail, toggle, toggleButton, link, children, header, item: E('li', { 'class': 'dashboard-topology-access' }, [ header, children ]) };
			this.accessNodes.set(key, entry);
		}
		const expanded = !this.closedAccess.has(key);
		attr(entry.icon, 'data-icon', access.icon);
		attr(entry.toggleButton, 'aria-expanded', String(expanded));
		attr(entry.toggleButton, 'aria-label', (expanded ? _('Collapse %s') : _('Expand %s')).format(access.name));
		entry.toggleButton.hidden = !access.members.length;
		attr(entry.link, 'data-dashboard-network', group.network);
		attr(entry.link, 'data-dashboard-access', access.id);
		attr(entry.link, 'data-dashboard-interface', access.device);
		attr(entry.link, 'aria-label', _('%s: go to details').format(access.name));
		attr(entry.item, 'data-relation', access.kind === 'unknown' ? 'unknown' : 'logical');
		attr(entry.item, 'data-access-key', key);
		attr(entry.header, 'data-active', access.active === false ? 'false' : null);
		text(entry.name, access.kind === 'unknown' ? _('Other devices') : access.name);
		text(entry.detail, access.members.length ? String(access.members.length) : '');
		attr(entry.link, 'title', access.detail);
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

	updateUnplaced(live) {
		const devices = this.model.unplaced;
		this.unplaced.hidden = !devices.length;
		if (devices.length && !this.unplacedInitialized) {
			this.unplaced.open = !this.model.groups.some(group => group.members.length);
			this.unplacedInitialized = true;
		}
		text(this.unplacedTitle, _('Attachment not identified (%d)').format(devices.length));
		const page = this.unplacedPage = Math.max(0, Math.min(this.unplacedPage, Math.ceil(devices.length / PAGE_SIZE) - 1));
		reconcile(this.unplacedList, devices.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(device => {
			const key = 'unplaced:' + device.id;
			const button = this.getNode(key, device, live, device.mac === this.selection.client && this.selection.network == null);
			const cached = this.nodes.get(key);
			cached.item ||= E('li', {}, button);
			return cached.item;
		}));
		this.unplacedPager.hidden = devices.length <= PAGE_SIZE;
		this.unplacedPrevious.disabled = page === 0;
		this.unplacedNext.disabled = (page + 1) * PAGE_SIZE >= devices.length;
		text(this.unplacedRange, devices.length ? _('%d–%d of %d').format(page * PAGE_SIZE + 1, Math.min((page + 1) * PAGE_SIZE, devices.length), devices.length) : '');
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
					this.pages.set(group.id, Math.floor(index / PAGE_SIZE));
				}
			}
			else if (!this.model.unplaced.some(member => member.mac === this.selection.client) || this.selection.network != null) {
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
		let activeIndex = model.groups.findIndex(group => group.id === this.activeGroup && (group.members.length || group.access?.length));
		if (activeIndex < 0) {
			activeIndex = model.groups.findIndex(group => group.members.length);
			if (activeIndex < 0)
				activeIndex = model.groups.findIndex(group => group.access?.length);
			this.activeGroup = model.groups[activeIndex]?.id;
			this.collapsed = false;
		}
		const group = model.groups[activeIndex];
		reconcile(this.upstreams, model.upstreams.length ? model.upstreams.map(up => this.getNode('up:' + up.id, up, live)) : [ this.upstreamEmpty ]);
		attr(this.upstreams, 'data-has-upstreams', model.upstreams.length ? 'true' : null);
		attr(this.upstreams, 'data-single', model.upstreams.length === 1 ? 'true' : null);
		reconcile(this.router, [ this.getNode('router', model.router, live, this.selection.tab === 'system') ]);
		attr(this.router, 'data-has-upstreams', model.upstreams.length ? 'true' : null);
		attr(this.router, 'data-has-groups', model.groups.length ? 'true' : null);
		attr(this.node, 'data-has-groups', model.groups.length ? 'true' : null);
		attr(this.node, 'data-no-upstreams', !model.upstreams.length ? 'true' : null);

		const available = new Map(model.groups.map(item => [ item.id, item ]));
		const ids = (this.visibleGroupIds || model.groups.slice().sort((a, b) => Number(!!b.members.length) - Number(!!a.members.length)).map(item => item.id)).filter(id => available.has(id)).slice(0, 4);
		if (group && !ids.includes(group.id)) {
			if (ids.length === 4)
				ids.pop();
			ids.push(group.id);
		}
		for (const item of model.groups)
			if (ids.length < 4 && !ids.includes(item.id))
				ids.push(item.id);
		this.visibleGroupIds = ids;
		const shownGroups = ids.map(id => available.get(id));
		this.allNetworks.hidden = model.groups.length <= 4;
		text(this.allNetworks, _('All networks (%d)').format(model.groups.length));
		const page = Math.max(0, Math.min(this.pages.get(group?.id) || 0, Math.ceil((group?.members.length || 0) / PAGE_SIZE) - 1));
		if (group)
			this.pages.set(group.id, page);
		const members = !this.collapsed ? group?.members.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) || [] : [];
		reconcile(this.groups, shownGroups.map(item => {
			const key = 'group:' + item.id;
			const button = this.getNode(key, Object.assign({}, item, { tab: null }), live, item === group && !this.collapsed, item.members.length > 0 || !!item.access?.length);
			const cached = this.nodes.get(key);
			cached.item ||= E('li', {}, button);
			attr(cached.item, 'data-has-links', item === group && !this.collapsed && item.access?.length ? 'true' : null);
			return cached.item;
		}));
		const access = !this.collapsed ? group?.access || [] : [];
		// Bound the overview while retaining every record in the Network tab.
		const accessIds = new Set(members.map(member => member.access));
		if (this.selection.access && access.some(item => item.id === this.selection.access))
			accessIds.add(this.selection.access);
		for (const item of access)
			if (accessIds.size < PAGE_SIZE)
				accessIds.add(item.id);
		const shownAccess = access.filter(item => accessIds.has(item.id));
		reconcile(this.clients, shownAccess.map(item => this.accessNode(group, item, members.filter(member => member.access === item.id), live)));
		this.allInterfaces.hidden = access.length <= shownAccess.length;
		attr(this.allInterfaces, 'data-dashboard-network', group?.network);
		text(this.allInterfaces, _('All interfaces (%d)').format(access.length));
		attr(this.endpoints, 'data-has-links', access.length ? 'true' : null);
		this.groups.hidden = !model.groups.length;
		this.endpoints.hidden = !group || this.collapsed;
		this.clients.hidden = !access.length;
		this.empty.hidden = !!access.length;
		text(this.empty, group?.summary || '');
		this.pager.hidden = !group || this.collapsed || group.members.length <= PAGE_SIZE;
		this.status.hidden = this.pager.hidden;
		text(this.range, group?.members.length ? _('%d–%d of %d').format(page * PAGE_SIZE + 1, Math.min((page + 1) * PAGE_SIZE, group.members.length), group.members.length) : '');
		this.previous.disabled = page === 0;
		this.next.disabled = !group || (page + 1) * PAGE_SIZE >= group.members.length;
		// Keep one set of nodes and focus state across responsive layouts.
		// On phones, expanding a network reveals its children directly below it.
		const branchParent = this.mobile.matches && group ? this.nodes.get('group:' + group.id).item : this.tree;
		if (this.endpoints.parentNode !== branchParent)
			branchParent.appendChild(this.endpoints);
		if (this.mobile.matches && group) {
			if (this.status.parentNode !== this.endpoints)
				this.endpoints.appendChild(this.status);
		}
		else if (this.status.previousElementSibling !== this.tree) {
			this.tree.after(this.status);
		}

		const notices = [];
		if (!model.interfacesAvailable)
			notices.push(_('Interface data unavailable.'));
		if (model.wifiSupported && !model.wifiAvailable)
			notices.push(_('Wireless data unavailable.'));
		if (model.partial)
			notices.push(_('Some attachment data is unavailable.'));
		text(this.notice, notices.join(' '));
		this.notice.hidden = !notices.length;
		this.updateUnplaced(live);
		connections.update(model, this.topologyEnabled !== false);
		for (const [key, entry] of this.accessNodes)
			if (entry.item.parentNode !== this.clients) {
				entry.item.remove();
				this.accessNodes.delete(key);
			}
		for (const key of this.closedAccess)
			if (!model.groups.some(group => group.access?.some(access => key === group.id + '|' + access.id)))
				this.closedAccess.delete(key);
		if (typeof requestAnimationFrame === 'function')
			requestAnimationFrame(() => this.updateConnectors());
		for (const id of this.nodes.keys())
			if (!live.has(id))
				this.nodes.delete(id);
		for (const id of this.pages.keys())
			if (!model.groups.some(group => group.id === id))
				this.pages.delete(id);
	},

	navigate(selection) {
		return connections.navigate(selection);
	},

	render(data) {
		this.connectionData = data;
		return {
			charts: [ { id: 'network_path_preview', node: () => { this.init(); return this.node; } } ],
			tabs: [ { id: 'connections', title: _('Network'), content: () => connections.render() } ]
		};
	}
});
