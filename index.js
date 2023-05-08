let callObject;

// Log events as they are triggered to see what's happening throughout the call
const logEvent = (e) => console.log("Daily event: ", e);

/**
 *
 * FUNCTIONS TO TOGGLE DOM ELEMENT VISIBILITY
 */

const showOwnerPanel = () => {
  // show the allow/deny buttons for anyone in the waiting room
  const buttons = document.getElementById("ownerKnockingButtons");
  buttons.classList.remove("hide");
};

const hideOwnerPanel = () => {
  // hide the allow/deny buttons for anyone in the waiting room
  const buttons = document.getElementById("ownerKnockingButtons");
  buttons.classList.add("hide");
};

const showWaitingRoomText = () => {
  // Show waiting room message after knocking
  const guestKnockingMsg = document.getElementById("guestKnocking");
  guestKnockingMsg.classList.remove("hide");
};

const hideWaitingRoomText = () => {
  // Show waiting room message after knocking
  const guestKnockingMsg = document.getElementById("guestKnocking");
  guestKnockingMsg.classList.add("hide");
};

const showLoadingText = (type) => {
  const id = type === "owner" ? "ownerLoading" : "guestLoading";
  const loading = document.getElementById(id);
  loading.classList.remove("hide");
};

const hideLoadingText = (type) => {
  const id = type === "owner" ? "ownerLoading" : "guestLoading";
  const loading = document.getElementById(id);
  loading.classList.add("hide");
};

const showRejectedFromCallText = () => {
  const guestDenied = document.getElementById("guestDenied");
  guestDenied.classList.remove("hide");
};

const hideRejectedFromCallText = () => {
  const guestDenied = document.getElementById("guestDenied");
  guestDenied.classList.add("hide");
};

/**
 *
 * OWNER-RELATED FUNCTIONS
 */

// Handle onsubmit event for the owner form
const submitOwnerForm = (e) => {
  e.preventDefault();
  // Do not try to create new call object if it already exists
  if (callObject) return;
  // Get form values
  const name = e.target.name.value;
  const url = e.target.url.value;
  const token = e.target.token.value;
  if (!name.trim() || !url.trim() || !token.trim()) {
    console.error("Fill out form");
    return;
  }
  // initialize the call object and let the owner join/enter the call
  createOwnerCall({ name, url, token });
};

// The owner will go right into the call since they have appropriate permissions
const createOwnerCall = async ({ name, url, token }) => {
  showLoadingText("owner");

  // Create call object
  callObject = await window.DailyIframe.createCallObject();

  // Add Daily event listeners (not an exhaustive list)
  // See: https://docs.daily.co/reference/daily-js/events
  callObject
    .on("joined-meeting", handleJoinedMeeting)
    .on("left-meeting", logEvent)
    .on("participant-joined", logEvent)
    .on("participant-updated", handleParticipantUpdate)
    .on("participant-left", handleParticipantLeft)
    .on("waiting-participant-added", addWaitingParticipant)
    .on("waiting-participant-updated", logEvent)
    .on("waiting-participant-removed", updateWaitingParticipant)
    .on("error", logEvent);

  // Let owner join the meeting
  try {
    const join = await callObject.join({ userName: name, url, token });

    // confirm participant is an owner of the call (i.e. can respond to knocking)
    if (join.local.owner !== true) {
      console.error("This participant is not a meeting owner!");
    } else {
      console.log("This participant is a meeting owner! :)");
    }
    hideLoadingText("owner");
    showOwnerPanel();
  } catch (error) {
    console.log("Owner join failed: ", error);
    loading.classList.add("hide");
  }
};

/**
 *
 * GUEST-RELATED FUNCTIONS
 */

const submitKnockingForm = (e) => {
  e.preventDefault();
  const name = e.target.name.value;
  const url = e.target.url.value;
  if (!name.trim() || !url.trim()) {
    console.error("Fill out form");
    return;
  }
  // if user is trying to join again, hide previous error
  hideRejectedFromCallText();
  // initialize guest call so they can knock to enter
  createGuestCall({ name, url });
};

// This function will create the call object and "join" the call.
// Joining for guests means going into the lobby and waiting for an owner to let them in.
const createGuestCall = async ({ name, url }) => {
  showLoadingText("guest");

  // Create call object
  callObject = await window.DailyIframe.createCallObject();

  // Add Daily event listeners (not an exhaustive list)
  // See: https://docs.daily.co/reference/daily-js/events
  callObject
    .on("joined-meeting", checkAccessLevel)
    .on("left-meeting", logEvent)
    .on("participant-joined", logEvent)
    .on("participant-updated", handleParticipantUpdate)
    .on("participant-left", handleParticipantLeft)
    .on("error", handleError)
    .on("access-state-updated", handleAccessStateUpdate);

  try {
    // pre-authenticate guest to make sure they need to knock before calling join() method
    await callObject.preAuth({ userName: name, url });
    // check that the guest actually needs to knock
    const permissions = await checkAccessLevel();
    console.log("access level: ", permissions);
    // if they're in the lobby, they need to knock
    if (permissions === "lobby") {
      // guests must call .join() before they can knock to enter the call
      await callObject.join();

      hideLoadingText("guest");
      showWaitingRoomText();

      // Request full access to the call (i.e. knock to enter)
      await callObject.requestAccess({ name });
    } else if (permissions === "full") {
      // if they can join the call, it's probably not a private room
      console.error("participant does not need to knock.");
      hideLoadingText("guest");
      const join = await callObject.join();
      addParticipantVideo(join.local);
    } else {
      console.error("Something went wrong while joining.");
    }
  } catch (error) {
    console.log("Guest knocking failed: ", error);
  }
};

/**
 *
 * VIDEO/EVENT-RELATED FUNCTIONS
 */

const checkAccessLevel = async () => {
  const state = await callObject.accessState();
  /* access level could be:
   - lobby (must knock to enter)
   - full (allowed to join the call)
   - none (can't join)
  */
  return state.access.level;
};

const handleJoinedMeeting = (e) => {
  const participant = e?.participants?.local;
  // this demo assumes videos are on when the call starts since there aren't controls in the UI.
  // update the room's settings to enable cameras by default.
  // https://docs.daily.co/reference/rest-api/rooms/config#start_video_off
  if (!participant?.tracks?.video) {
    console.log('Video is off. Ensure "start_video_off" setting is false for your room');
    return;
  }
  addParticipantVideo(participant);
};

const handleParticipantUpdate = async (e) => {
  const level = await checkAccessLevel();
  console.log("current level: ", level);
  // don't use this event for participants who are waiting to join
  if (level === "lobby") return;

  // don't use this event for the local participant
  const participant = e?.participant;
  if (!participant || participant.local) return;

  // In a complete video call app, you would listen for different updates (e.g. toggling video/audio).
  // For now, we'll just see if a video element exists for them and add it if not.
  const vid = findVideoForParticipant(participant.session_id);
  if (!vid) {
    // No video found for remote participant after update. Add one.
    console.log("Adding new video");
    addParticipantVideo(participant);
  }
};

const handleParticipantLeft = (e) => {
  // remove the video element for participant who left
  const participant = e?.participant;
  const vid = findVideoForParticipant(participant.session_id);
  if (vid) {
    vid.remove();
  }
};

const addParticipantVideo = async (participant) => {
  if (!participant) return;
  // if the participant is an owner, we'll put them up top; otherwise, in the guest container
  let videoContainer = document.getElementById(
    participant.owner ? "ownerVideo" : "guestVideo"
  );

  let vid = findVideoForParticipant(participant.session_id);
  if (!vid && participant.video) {
    // create video element, set attributes
    vid = document.createElement("video");
    vid.session_id = participant.session_id;
    vid.style.width = "100%";
    vid.autoplay = true;
    vid.muted = true;
    vid.playsInline = true;
    // append to container (either guest or owner section)
    videoContainer.appendChild(vid);
    // set video track
    vid.srcObject = new MediaStream([participant.tracks.video.persistentTrack]);
  }
};

const findVideoForParticipant = (session_id) => {
  // find the video element with a session id that matches
  for (const vid of document.getElementsByTagName("video")) {
    if (vid.session_id === session_id) {
      return vid;
    }
  }
};

const handleAccessStateUpdate = (e) => {
  // if the access level has changed to full, the knocking participant has been let in.
  if (e.access.level === "full") {
    // add the participant's video (it will only be added if it doesn't already exist)
    const local = callObject.participants().local;
    addParticipantVideo(local);
    hideWaitingRoomText();
  } else {
    console.log(e);
  }
};

const leaveCall = async () => {
  if (callObject) {
    console.log("leaving call");
    // clean up callObject so the demo can be used again
    await callObject.leave();
    await callObject.destroy();
    callObject = null;

    // remove all video elements
    const videoEls = [...document.getElementsByTagName("video")];
    videoEls.forEach((v) => v.remove());

    // reset UI
    hideOwnerPanel();
    hideWaitingRoomText();
    hideRejectedFromCallText();

    // todo: add .off() events: https://docs.daily.co/reference/rn-daily-js/instance-methods/off
  } else {
    console.log("not in a call to leave");
  }
};

/**
 *
 * KNOCKING-RELATED FUNCTIONS
 */
const allowAccess = () => {
  console.log("allow guest in");
  const waiting = callObject.waitingParticipants();

  const waitList = Object.keys(waiting);
  // We'll let the whole list in to keep this functionality simple.
  // You could also add a button next to each name to let individual guests in and then have an "Accept all" and "Deny all" option to respond in one batch.
  waitList.forEach(async (id) => {
    await callObject.updateWaitingParticipant(id, {
      grantRequestedAccess: true,
    });
  });
  // You could also use callObject.updateWaitingParticipants(*) to let everyone in at once. The example above to is show the more common example of programmatically letting people in one at a time.
};

const denyAccess = () => {
  console.log("deny guest access");
  const waiting = callObject.waitingParticipants();

  const waitList = Object.keys(waiting);
  // we'll deny the whole list to keep the UI simple
  waitList.forEach(async (id) => {
    await callObject.updateWaitingParticipant(id, {
      grantRequestedAccess: false,
    });
  });
};

const handleError = (e) => {
  logEvent(e);
  // The request to join (knocking) was rejected :(
  if (e.errorMsg === "Join request rejected") {
    hideWaitingRoomText();
    showRejectedFromCallText();
  }
};

const addWaitingParticipant = (e) => {
  const list = document.getElementById("knockingList");
  const li = document.createElement("li");
  li.setAttribute("id", e.participant.id);
  li.innerHTML = `${e.participant.name}: ${e.participant.id}`;
  // add new list item to ul element
  list.appendChild(li);
};

const updateWaitingParticipant = (e) => {
  logEvent(e);
  // get the li of the waiting participant who was removed from the list
  // They would be "removed" whether they were accepted or rejected -- they're just not waiting anymore.
  const id = e.participant.id;
  const li = document.getElementById(id);
  // if the li exists, remove it from the list
  if (li) {
    li.remove();
  }
};

/**
 *
 * EVENT LISTENERS
 */
const knockingForm = document.getElementById("knockingForm");
knockingForm.addEventListener("submit", submitKnockingForm);

const ownerForm = document.getElementById("ownerForm");
ownerForm.addEventListener("submit", submitOwnerForm);

const allowAccessButton = document.getElementById("allowAccessButton");
allowAccessButton.addEventListener("click", allowAccess);

const denyAccessButton = document.getElementById("denyAccessButton");
denyAccessButton.addEventListener("click", denyAccess);

const leaveButton = document.getElementById("leaveButton");
leaveButton.addEventListener("click", leaveCall);
