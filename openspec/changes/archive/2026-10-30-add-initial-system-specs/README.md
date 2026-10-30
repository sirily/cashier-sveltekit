# add-initial-system-specs

Initial specification change, published and archived on 2026-10-30 at the owner's explicit
request, for the owner's Cashier workflows:

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

The earlier premature archive was reversed for review. After owner approval of all 14 tasks,
the four capability deltas were published to [main specs](../../../specs/) and this change
was archived. This supersedes the review-time publication hold in the planning artifacts.
The recorded implementation gaps remain historical findings, not completed runtime fixes.
