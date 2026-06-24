const SUPABASE_URL = 'https://aogxafkugxpcahevjudg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_HO4X6eWI757QbeedU2LLfw_ikknLNdf';

// Đổi tên biến thành supabaseClient để không trùng với biến supabase mặc định của CDN
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Các thẻ UI
const loginSection = document.getElementById('loginSection');
const appSection = document.getElementById('appSection');

// 1. Kiểm tra xem user đã đăng nhập từ trước chưa (nhớ phiên)
async function checkSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        showApp();
    } else {
        showLogin();
    }
}
checkSession(); // Chạy ngay khi mở trang

// 2. Xử lý nút Đăng nhập
document.getElementById('btnLogin').addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('loginError');

    // Gọi API của Supabase để xác thực
    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        errorMsg.classList.remove('hidden');
    } else {
        errorMsg.classList.add('hidden');
        showApp();
    }
});

// 3. Xử lý nút Đăng xuất
document.getElementById('btnLogout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    showLogin();
});

// Hàm đổi giao diện
function showLogin() {
    loginSection.classList.remove('hidden');
    appSection.classList.add('hidden');
}

function showApp() {
    loginSection.classList.add('hidden');
    appSection.classList.remove('hidden');
}

// ----------------------------------------------------
// CODE LOGIC TRA CỨU (TỐI ƯU REALTIME, BỎ POLLING)
// ----------------------------------------------------
let currentRequestId = null;
let currentChannel = null; // Biến quản lý kênh lắng nghe để tránh trùng lặp

document.getElementById('btnSearch').addEventListener('click', async () => {
    const ma_qhns = document.getElementById('ma_qhns').value;
    const tu_ngay = document.getElementById('tu_ngay').value;
    const den_ngay = document.getElementById('den_ngay').value;

    // Hiển thị hiệu ứng Đang tải đẹp mắt
    document.getElementById('resultBody').innerHTML = `
        <tr>
            <td colspan="9" class="text-center p-8">
                <div class="flex flex-col items-center justify-center">
                    <svg class="animate-spin h-8 w-8 text-[#1a56db] mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    <span class="text-[#1a56db] font-semibold text-sm">Đang truy vấn Kho bạc, vui lòng chờ...</span>
                </div>
            </td>
        </tr>`;

    // 1. Tạo request mới trên Supabase
    const { data, error } = await supabaseClient
        .from('TraCuuRequests')
        .insert([{ ma_qhns, tu_ngay, den_ngay }])
        .select();

    if (error) {
        alert("Lỗi tạo yêu cầu!");
        console.error(error);
        return;
    }
    
    currentRequestId = data[0].request_id;

    // 2. Kích hoạt lắng nghe Realtime thay cho Polling
    setupRealtimeListener(currentRequestId);
});

// Hàm thiết lập Realtime thông minh (Khắc phục lỗi Race Condition)
function setupRealtimeListener(reqId) {
    if (currentChannel) {
        supabaseClient.removeChannel(currentChannel);
    }

    currentChannel = supabaseClient.channel(`req-channel-${reqId}`)
        // Lắng nghe 1: Khi BE xử lý xong/update từng file chứng từ
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'ChiTietChungTu', filter: `request_id=eq.${reqId}` },
            (payload) => {
                fetchAndRender(reqId);
            }
        )
        // Lắng nghe 2: Khi BE báo trạng thái tổng của Request
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'TraCuuRequests', filter: `request_id=eq.${reqId}` },
            (payload) => {
                handleRequestStatus(payload.new.status, reqId);
            }
        )
        // Bắt buộc kiểm tra lại trạng thái ngay khi vừa kết nối Websocket xong
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                // Đọc lại DB để xem BE đã cập nhật trạng thái trong lúc FE đang mở kết nối không
                const { data } = await supabaseClient.from('TraCuuRequests').select('status').eq('request_id', reqId).single();
                if (data) {
                    handleRequestStatus(data.status, reqId);
                }
            }
        });
}

// Tách logic xử lý trạng thái ra một hàm riêng cho gọn
function handleRequestStatus(status, reqId) {
    if (status === 'no_data') {
        document.getElementById('resultBody').innerHTML = `
            <tr><td colspan="9" class="text-center p-6 text-red-500 font-bold bg-red-50">Không tìm thấy chứng từ nào trong khoảng thời gian này.</td></tr>`;
    } else if (status === 'completed') {
        fetchAndRender(reqId);
    }
}

async function fetchAndRender(reqId) {
    const { data } = await supabaseClient.from('ChiTietChungTu').select('*').eq('request_id', reqId).order('so_chung_tu', { ascending: true });
    
    const tbody = document.getElementById('resultBody');
    if (!data || data.length === 0) return; // Nhường cho sự kiện 'no_data' xử lý

    tbody.innerHTML = ''; // Xoá cũ

    data.forEach((row, index) => {
        let actionHtml = '';
        if (row.file_status === 'completed') {
            const safeFileName = `${row.so_chung_tu}.pdf`;
            actionHtml = `
                <div class="flex items-center justify-center space-x-1 sm:space-x-2">
                    <button onclick="viewPDFBlob('${row.file_url}')" class="text-blue-600 font-semibold hover:text-blue-800 hover:underline cursor-pointer transition">Xem</button>
                    <span class="text-gray-300">|</span>
                    <a href="${row.file_url}?download=${safeFileName}" class="text-green-600 font-semibold hover:text-green-800 hover:underline cursor-pointer transition">Tải</a>
                </div>
            `;
        } else if (row.file_status === 'no_file') {
            actionHtml = `<span class="text-gray-400 italic">Trống</span>`;
        } else if (row.file_status === 'dvc_error' || row.file_status === 'supabase_error') {
            actionHtml = `<span class="text-red-500 font-semibold">Lỗi</span> - <button onclick="retryFile('${row.id}')" class="font-bold cursor-pointer hover:text-red-700">🔄 Tải lại</button>`;
        } else {
            // Hiển thị hiệu ứng xoay nhỏ ngay trên từng dòng chứng từ
            actionHtml = `
                <div class="flex items-center justify-center space-x-1">
                    <svg class="animate-spin h-4 w-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    <span class="text-gray-500 italic text-xs">Đang tải...</span>
                </div>`;
        }

        const tr = document.createElement('tr');
        tr.className = "text-[11px] sm:text-xs bg-white hover:bg-blue-50 transition-colors";
        
        tr.innerHTML = `
            <td class="p-2 border text-center">${index + 1}</td>
            <td class="p-2 border font-medium">${row.so_chung_tu || ''}</td>
            <td class="border p-0">
                <div class="p-2 w-full h-full overflow-hidden text-ellipsis whitespace-nowrap" title="${row.chi_tiet || ''}">${row.chi_tiet || ''}</div>
            </td>
            <td class="p-2 border text-center">${row.sotk_so || ''}</td>
            <td class="p-2 border text-center">${row.ngay_hoan_thanh || ''}</td>
            <td class="p-2 border text-center">${row.ngay_tabmis_thanh_toan || ''}</td>
            <td class="border p-0">
                <div class="p-2 w-full h-full overflow-hidden text-ellipsis whitespace-nowrap" title="${row.ten_trang_thai || ''}">${row.ten_trang_thai || ''}</div>
            </td>
            <td class="p-2 border font-mono text-right text-green-700 font-semibold">${row.tong_so_tien ? Number(row.tong_so_tien).toLocaleString('vi-VN') : ''}</td>
            <td class="p-2 border-l border-b text-center whitespace-nowrap sticky right-0 bg-inherit shadow-[-2px_0_5px_rgba(0,0,0,0.05)] z-10">${actionHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Hàm Retry
window.retryFile = async (id) => {
    await supabaseClient.from('ChiTietChungTu').update({ file_status: 'retry_pending' }).eq('id', id);
};

// Bổ sung xử lý lỗi vào hàm fetch Blob
window.viewPDFBlob = async (url) => {
    try {
        const response = await fetch(url);
        
        // Kiểm tra xem request có thành công không
        if (!response.ok) {
            throw new Error(`Mã lỗi HTTP: ${response.status}`);
        }
        
        const blob = await response.blob();
        
        // Cảnh báo nếu dữ liệu tải về không mang định dạng PDF
        if (blob.type !== 'application/pdf' && !blob.type.includes('pdf')) {
            console.warn("Cảnh báo: Tệp lấy về có thể không phải PDF hợp lệ. Loại MIME:", blob.type);
        }

        const file = new Blob([blob], { type: 'application/pdf' });
        const fileURL = URL.createObjectURL(file);
        
        window.open(fileURL, '_blank');
    } catch (error) {
        alert("Không thể mở file. Có thể dữ liệu gốc bị hỏng hoặc cấu hình bảo mật chặn tải (CORS).");
        console.error("Chi tiết lỗi Blob:", error);
    }
};

// ----------------------------------------------------
// TỰ ĐỘNG ĐĂNG XUẤT SAU 15 PHÚT KHÔNG THAO TÁC
// ----------------------------------------------------
function setupInactivityTimeout() {
    let timeoutTimer;
    const INACTIVITY_TIME = 15 * 60 * 1000; // 15 phút

    function resetTimer() {
        clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(autoLogout, INACTIVITY_TIME);
    }

    async function autoLogout() {
        // Chỉ đăng xuất nếu đang có phiên đăng nhập
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            await supabaseClient.auth.signOut();
            showLogin();
            alert("Bạn đã không thao tác trong 15 phút. Hệ thống tự động đăng xuất để đảm bảo an toàn.");
        }
    }

    // Lắng nghe các sự kiện thao tác của người dùng
    window.onload = resetTimer;
    document.onmousemove = resetTimer;
    document.onkeydown = resetTimer;
    document.onclick = resetTimer;
    document.onscroll = resetTimer;
}

// Kích hoạt tính năng
setupInactivityTimeout();
