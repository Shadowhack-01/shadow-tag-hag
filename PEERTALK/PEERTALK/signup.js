import { supabase } from './supabaseClient.js'; // Make sure this path is correct

document.addEventListener('DOMContentLoaded', () => {
    const signupForm = document.getElementById('signup-form');

    if (signupForm) {
        signupForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // Prevent default form submission

            const emailInput = document.getElementById('email');
            const passwordInput = document.getElementById('password');
            const nicknameInput = document.getElementById('nickname');

            const email = emailInput.value;
            const password = passwordInput.value;
            const nickname = nicknameInput.value;

            // Basic validation
            if (!email || !password || !nickname) {
                alert('Please fill in all fields.');
                return;
            }

            try {
                // Use Supabase to sign up the user
                // Pass nickname in the data option to store it in user_metadata
                const { data, error } = await supabase.auth.signUp({
                    email: email,
                    password: password,
                    options: {
                        data: {
                            nickname: nickname // Store nickname in user_metadata
                        }
                    }
                });

                if (error) {
                    console.error('Supabase Sign Up Error:', error.message);
                    alert('Sign up failed: ' + error.message);
                } else {
                    console.log('Sign up successful:', data);
                    // Check if email confirmation is required
                    if (data.user && data.user.identities && data.user.identities.length === 0) {
                         alert('Sign up successful! Please check your email for a confirmation link.');
                    } else {
                         alert('Sign up successful!');
                    }

                    // Redirect to login page after successful sign-up
                    window.location.href = 'login.html';
                }

            } catch (error) {
                console.error('An unexpected error occurred during sign up:', error);
                alert('An unexpected error occurred. Please try again.');
            }
        });
    }
});
