# add-initial-system-specs

Active, reopened initial specification change for the owner's Cashier workflows:

- server-ledger synchronization;
- manual-transaction writeback;
- offline transaction entry;
- full-book analysis and reports.

WebDAV was included by mistake. The owner confirmed it has never been used and is not wanted;
it is excluded from this change's capability set. No WebDAV runtime code is removed here.

Read [proposal.md](proposal.md) for scope, [design.md](design.md) for source precedence and
known implementation gaps, and [tasks.md](tasks.md) for review status. Detailed scenarios
live in this change's `specs/` directory. They are required behavior, not proof that every
scenario already passes in the application.

The premature archive has been reversed, including its generated main specs. Continue within
this change and do not archive or publish it again until the owner explicitly requests it.
