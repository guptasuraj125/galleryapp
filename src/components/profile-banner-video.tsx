interface ProfileBanner {
  url: string;
}

export function ProfileBannerVideo({
  banner,
  displayName,
}: {
  banner: ProfileBanner | null;
  displayName: string;
}) {
  return (
    <div className="profile-banner-frame">
      {banner
        ? <video
          aria-label={`${displayName} profile banner video`}
          autoPlay
          controls={false}
          loop
          muted
          playsInline
          preload="metadata"
          src={banner.url}
        />
        : <div className="profile-banner-empty">Profile video banner</div>}
      <span className="profile-banner-caption">PROFILE</span>
    </div>
  );
}
