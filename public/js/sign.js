// Combined single-file version of signView.js + signupModel.js + signController.js

const ajaxToServer = async function (url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  const data2 = await response.json();
  return data2;
};

class SignView {
  #loginForm = document.querySelector("form.login");
  #signupForm = document.querySelector("form.signup");
  #signupBtn = document.querySelector("label.signup");
  #loginRadio = document.getElementById("login");
  #signupRadio = document.getElementById("signup");
  #signupLink = document.querySelector("form .signup-link a");
  #signupFullName = document.querySelector(".full-name-singup");
  #signupEmail = document.querySelector(".email-singup");
  #signupPassword = document.querySelector(".password-singup");
  #signupConfirmPassword = document.querySelector(".Cpassword-singup");
  #signupStudentId = document.querySelector(".studentid-singup");
  #signupParentPhone = document.querySelector(".parentphone-singup");
  #signupDob = document.querySelector(".dob-singup");
  #signupReferral = document.querySelector(".referral-singup");
  #loginFullName = document.querySelector(".full-name-login");
  #loginPassword = document.querySelector(".password-login");
  #signupBtnClick = document.querySelector(".btn-signup");
  #loginBtnClick = document.querySelector(".btn-login");
  #login = document.querySelector(".login");
  #signup = document.querySelector(".signup");
  #formContainer = document.querySelector(".form-container");
  #check = document.querySelector(".wrappeer");
  #spinner = document.querySelector(".spinner");

  constructor() {
    this.#setMoveListeners();
  }

  #setMoveListeners() {
    this.#signupLink.onclick = () => {
      this.#signupBtn.click();
      return false;
    };

    this.#loginForm.style.display = "block";
    this.#loginForm.classList.add("active");
    this.#signupForm.style.display = "none";

    this.#loginRadio.addEventListener("change", () => {
      this.#signupForm.classList.remove("active");
      setTimeout(() => {
        this.#signupForm.style.display = "none";
        this.#loginForm.style.display = "block";
        requestAnimationFrame(() => this.#loginForm.classList.add("active"));
      }, 350);
    });

    this.#signupRadio.addEventListener("change", () => {
      this.#loginForm.classList.remove("active");
      setTimeout(() => {
        this.#loginForm.style.display = "none";
        this.#signupForm.style.display = "block";
        requestAnimationFrame(() => this.#signupForm.classList.add("active"));
      }, 350);
    });
  }

  setSignUpHandler(handler) {
    this.#signupBtnClick.addEventListener("click", handler);
  }

  setLoginHandler(handler) {
    this.#loginBtnClick.addEventListener("click", handler);
  }

  getInputDataSignup() {
    const Obj = {};
    Obj.name = this.#signupFullName.value.trim();
    Obj.email = this.#signupEmail.value.trim();
    Obj.password = this.#signupPassword.value.trim();
    Obj.passwordConfirm = this.#signupConfirmPassword.value.trim();
    Obj.studentId = this.#signupStudentId.value.trim();
    Obj.parentPhone = this.#signupParentPhone.value.trim();
    Obj.dob = this.#signupDob.value;
    Obj.referral = this.#signupReferral.value;
    Obj.screenWidth = screen.width;
    Obj.screenHeight = screen.height;
    Obj.userAgent = navigator.userAgent;
    return Obj;
  }

  getInputDataLogin() {
    const Obj = {};
    Obj.name = this.#loginFullName.value.trim();
    Obj.password = this.#loginPassword.value.trim();
    Obj.screenWidth = screen.width;
    Obj.screenHeight = screen.height;
    Obj.userAgent = navigator.userAgent;
    return Obj;
  }

  toggleSpinner() {
    this.#login.classList.toggle("hidden");
    this.#signup.classList.toggle("hidden");
    this.#formContainer.classList.toggle("hidden");
    this.#check.classList.add("hidden");
    this.#spinner.classList.toggle("hidden");
  }

  showScucessMessage(msg = "تم انشاء حسابك بنجاح") {
    this.#check.classList.remove("hidden");
    this.#check.querySelector(".created").textContent = msg;
    this.#login.classList.toggle("hidden");
    this.#signup.classList.toggle("hidden");
    this.#formContainer.classList.toggle("hidden");
  }

  showError(response, type) {
    const errs = [...document.querySelectorAll(".error")];
    errs.forEach((err) => {
      err.classList.add("hidden");
    });
    const errDiv = document.querySelector(
      `.error-${response.path}${type === "login" ? "-login" : ""}`
    );
    errDiv.classList.remove("hidden");
    const msgDiv = errDiv.querySelector(".error-message");
    msgDiv.textContent = response.message.slice(17).split(",")[0];
  }
}

const signView = new SignView();

const domain = document.body.dataset.domain;

// back to the page that asked for sign in (e.g. a shared test link)
const nextPage = (() => {
  const next = new URLSearchParams(location.search).get("next") || "";
  return /^\/(?![\/\\])/.test(next) ? next : "/";
})();

const signUpHandler = async function (e) {
  e.preventDefault();
  const data = signView.getInputDataSignup();
  signView.toggleSpinner();
  const response = await ajaxToServer(domain + "/api/v1/users/signup", data);
  signView.toggleSpinner();
  if (response.status === "success") {
    signView.showScucessMessage(); //TODO
    setTimeout(() => {
      location.assign(nextPage);
    }, 2000);
  }
  if (response.status === "fail") signView.showError(response); //TODO
};

const setSignUpBtnClickListener = function () {
  signView.setSignUpHandler(signUpHandler);
};

const loginHandler = async function (e) {
  e.preventDefault();
  const data = signView.getInputDataLogin();
  signView.toggleSpinner();
  const response = await ajaxToServer(domain + "/api/v1/users/login", data);
  signView.toggleSpinner();
  if (response.status === "success") {
    signView.showScucessMessage("تم تسجيل الدخول بنجاح");
    setTimeout(() => {
      location.assign(nextPage);
    }, 2500);
  }
  if (response.status === "fail") signView.showError(response, "login");
};

const setLoginClickListener = function () {
  signView.setLoginHandler(loginHandler);
};

const init = function () {
  setSignUpBtnClickListener();
  setLoginClickListener();
};

init();
