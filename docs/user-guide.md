# User guide

## Everyone

**Theme.** Use the sun / moon / desktop switch to choose the theme:
- **Light** or **Dark** fixes it.
- **Auto** follows your device's setting.

The choice is remembered on that device. You'll find the switch in three places:
- the sidebar footer on the desk and in admin
- the top-right corner of the desk sign-in page
- the handheld status bar, as a single button that cycles through the three

**Guided tour.** The first time you open the desk's Exceptions page or the
handheld home on a device, a short tour points out the main controls. Skip it
any time. To see it again, use **Take the tour**: in the desk sidebar footer, or
under the warehouse list on the handheld. On a narrow desk window, steps for the
collapsed sidebar are left out.

## Handheld (warehouse workers)

Sign in at `/h/login` with the **device id**, your **username** and your
**4-digit PIN**. The first sign-in needs a connection to download the warehouse
data. After that, the handheld works offline.

**Status bar**, at the top of every screen:
- **Online / Offline**, and **N pending**: movements recorded on this device but
  not yet sent.
- **N need attention**: movements the server rejected. Tap it to review them.
- **Synced …**: when the data was last refreshed. Stale data is flagged.
- **Sync now**: push and refresh straight away. Syncing also happens
  automatically when you're connected.
- The leading icon sums it up:
  - **✓**: everything is synced.
  - **cloud**: work is waiting to be sent.
  - **warning**: something needs you.

**Warehouse actions** (home screen):

| Action | What you do |
|---|---|
| **Stock** | See quantities by bin, including your pending changes |
| **Count** | Scan a bin and a product, enter what you see. Counts are blind: you never see the expected number |
| **Move** | Move a quantity from one bin to another |
| **Pick** | Pick against a pick list line |
| **Adjust** | Add or remove stock with a reason (Damaged, Found, Lost…) |
| **Transfer in** | Receive stock sent from another warehouse |

Everything you record is kept on the device until the server accepts it. Nothing
is lost if you go offline, if the server rejects a row, or if the device is
revoked. A revoked device keeps its work and can **Export outbox** from the
attention screen.

## Supervisor desk

Sign in at `/desk/login`. The sidebar switches warehouse and section.

- **Exceptions.** The tiles count open exceptions by type; tap one to filter.
  Types:
  - **Negative balance**: a bin went below zero.
  - **Count variance**: a count was off by more than the tolerance.
  - **Late movement**: an earlier movement arrived after a count and changed it.
  - **Over-pick**
  - **Transfer stuck**
  - **Clock skew**: a device clock is wrong.
- **Exception detail.** The **crossing lanes** chart puts the order things
  *happened* (top) against the order they *arrived* (bottom). A red crossing
  line marks a movement that arrived late. The lists below give the details.
  Resolve with:
  - **Accept**
  - **Correcting adjustment**: a signed quantity, a reason, a product and a bin.
  - **Request recount**
  - **Dismiss**

  If someone else resolved it first, you'll see a conflict instead of a double
  resolution. Exceptions that a later movement made consistent show as
  *Resolved: SUPERSEDED* by the system.
- **Stock**: balances per product and bin, with the full ledger for each.
- **Pick lists** and **Counts**: create and assign pick lists and count tasks
  for workers.

## Admin

Admins can use the desk too. **Admin** in the sidebar footer opens `/admin`.

- **Warehouses**: create a warehouse, which sets up its database. Finish setup
  or run migrations when the status asks for it. Manage locations from here as
  well.
- **Products, categories, reason codes**: master data.
  - A product's count tolerance falls back to its category's.
  - System reason codes can't be edited.
- **Users**: create users, set roles, reset PINs (this also unlocks the
  account), disable or enable. You can't change your own access, and there must
  always be at least one active admin.
- **Devices**: enroll handhelds, choose their warehouses, revoke or restore.
  Revoking stops syncing, but the device's recorded work stays in its outbox.

Nothing is ever hard-deleted. Things are deactivated, disabled or revoked
instead.
