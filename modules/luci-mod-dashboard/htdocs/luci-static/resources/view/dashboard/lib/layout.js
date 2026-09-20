'use strict';
'require baseclass';
'require form';
'require uci';
'require ui';
'require view.dashboard.lib.widgets as widgets';

return baseclass.extend({
	// One list per slot: what is in it is shown, in that order.
	render(includes) {
		const hint = _('Drag to reorder; leave empty to use the defaults.');
		const slots = {
			cards: [ _('Status cards'), _('The status cards at the top of the page.') ],
			charts: [ _('Charts'), _('The charts in the middle of the page.') ],
			tabs: [ _('Tabs'), _('The tabs at the bottom of the page.') ]
		};

		const m = new form.Map('dashboard');
		const s = m.section(form.NamedSection, 'layout', 'dashboard');

		widgets.slots.forEach(slot => {
			const choices = widgets.list(includes, slot);

			if (!choices.length)
				return;

			const o = s.option(form.DynamicList, slot, slots[slot][0], '%s %s'.format(slots[slot][1], hint));

			choices.forEach(widget => o.value(widget.id, widget.title));

			// Show the defaults while the slot is not configured, without
			// writing them.
			o.cfgvalue = () => {
				const known = choices.map(widget => widget.id);
				const ids = L.toArray(uci.get('dashboard', 'layout', slot)).filter(id => known.includes(id));

				return ids.length ? ids : widgets.defaults(includes, slot);
			};
		});

		return m.render().then(node => E('div', {}, [
			node,
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'cbi-button cbi-button-apply',
					'click': ui.createHandlerFn(this, () => m.save().then(() => ui.changes.apply(true)))
				}, [ _('Save & Apply') ])
			])
		]));
	}
});
