"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, UserPlus, X } from "lucide-react";
import { readJson } from "@/src/lib/api-response";
import { ThemeToggle } from "@/src/components/theme-toggle";

interface MemberData {
  members: Array<{
    id: string;
    role: "owner" | "member";
    user: { email: string; displayName: string; username: string } | null;
  }>;
  invitations: Array<{ id: string; email: string; expiresAt: string }>;
}

export function MemberManager() {
  const [data, setData] = useState<MemberData>({ members: [], invitations: [] });
  const [email, setEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      setData(await readJson<MemberData>(await fetch("/api/members", { cache: "no-store" })));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The member list could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, []);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setInviteUrl("");
    try {
      const result = await readJson<{ inviteUrl?: string; added?: boolean }>(await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }));
      if (result.inviteUrl) setInviteUrl(result.inviteUrl);
      if (result.added) setNotice("They are now part of your space.");
      setEmail("");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The invite could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setNotice("");
    try {
      await readJson(await fetch("/api/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      }));
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "This member could not be removed.");
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice("Invite link copied. It expires in seven days.");
    } catch {
      setNotice("Copy the invite link from the field below. It expires in seven days.");
    }
  }

  return (
    <main className="library-page">
      <header className="library-header">
        <Link className="library-back" href="/home"><ArrowLeft size={16} /> Our space</Link>
        <div className="library-header-actions">
          <Link href="/gallery">Open gallery</Link>
          <ThemeToggle />
        </div>
      </header>
      <section className="member-manager">
        <p className="eyebrow">A private little circle</p>
        <h1>Our people</h1>
        <p className="member-intro">Only people invited by the owner can see this space. Invite a new person with a one-time link.</p>

        <form className="member-invite-form" onSubmit={invite}>
          <label htmlFor="member-email">Their email address</label>
          <div>
            <input id="member-email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
            <button className="primary-button" disabled={busy} type="submit"><UserPlus size={16} /> {busy ? "Preparing…" : "Invite"}</button>
          </div>
        </form>
        {inviteUrl && (
          <div className="invite-link-box">
            <label htmlFor="invite-url">Share this one-time link (expires in 7 days)</label>
            <div><input id="invite-url" readOnly value={inviteUrl} /><button className="outline-button" onClick={() => void copyInvite()} type="button"><Copy size={14} /> Copy</button></div>
          </div>
        )}

        {notice && <p className="library-notice" role="status">{notice}</p>}
        <section className="member-list">
          <h2>People in this space</h2>
          {loading ? <p>Gathering your people…</p> : data.members.map((member) => (
            <article className="member-row" key={member.id}>
              <div><strong>{member.user?.displayName ?? "Space member"}</strong><span>{member.user?.email ?? ""} · {member.role}</span></div>
              {member.role !== "owner" && <button aria-label={`Remove ${member.user?.displayName ?? "member"}`} className="upload-remove" onClick={() => void remove(member.id)} type="button"><X size={16} /></button>}
            </article>
          ))}
        </section>
        {data.invitations.length > 0 && (
          <section className="member-list">
            <h2>Waiting for their hello</h2>
            {data.invitations.map((invite) => (
              <article className="member-row" key={invite.id}>
                <div><strong>{invite.email}</strong><span>Invite expires {new Date(invite.expiresAt).toLocaleDateString()}</span></div>
                <button aria-label={`Revoke invite for ${invite.email}`} className="upload-remove" onClick={() => void remove(invite.id)} type="button"><X size={16} /></button>
              </article>
            ))}
          </section>
        )}
      </section>
    </main>
  );
}
